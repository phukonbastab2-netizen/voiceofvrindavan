import * as T from './three.module.js';

const stage = document.querySelector('#stage');
const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
let reduced = motionPreference.matches;
let renderer;
let stopped = false;
let animation;

function fallback() {
  stopped = true;
  cancelAnimationFrame(animation);
  document.body.classList.remove('ready');
  window.__logoReady = false;
}

try {
  const response = await fetch('/logo/shapes.json');
  if (!response.ok) throw new Error('Logo unavailable');
  const shapes = await response.json();
  renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  renderer.domElement.setAttribute('aria-hidden', 'true');
  renderer.domElement.addEventListener('webglcontextlost', fallback);
  stage.append(renderer.domElement);

  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(34, 1, .1, 150);
  const logo = new T.Group();
  const emblem = new T.Group();
  const wordmark = new T.Group();
  logo.add(emblem, wordmark);
  scene.add(logo);

  // Broad light cards bring out the bevels in the original gold artwork.
  const studio = new T.Scene();
  studio.background = new T.Color('#807d70');
  for (const [x, y, z, w, h, power] of [
    [-3, 3, 10, 8, 8, 1.8], [-8, 8, 7, 8, 14, 4],
    [9, 2, 5, 4, 13, 3], [0, -8, 3, 18, 2, 2]
  ]) {
    const card = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({
      color: new T.Color(power, power * .97, power * .9), side: T.DoubleSide
    }));
    card.position.set(x, y, z);
    card.lookAt(0, 0, 0);
    studio.add(card);
  }
  const pm = new T.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(studio, .035).texture;
  pm.dispose();
  studio.traverse(object => {
    if (object.isMesh) { object.geometry.dispose(); object.material.dispose(); }
  });
  scene.add(new T.AmbientLight(0xfff0d2, 1));
  const light = new T.DirectionalLight(0xfff4df, 3.2);
  light.position.set(-3, 4, 8);
  scene.add(light);
  const rim = new T.DirectionalLight(0xffffff, 2.4);
  rim.position.set(6, -2, 3);
  scene.add(rim);
  const gold = new T.MeshStandardMaterial({ color: 0xe2b24f, metalness: .82, roughness: .22, envMapIntensity: 1.35 });
  const edge = new T.MeshStandardMaterial({ color: 0xb88638, metalness: .8, roughness: .25, envMapIntensity: 1.45 });
  const path = (points, Type) => new Type(points.map(([x, y]) => new T.Vector2(x / 100, -y / 100)));

  for (const item of shapes) {
    const shape = path(item.outer, T.Shape);
    shape.holes = item.holes.map(points => path(points, T.Path));
    const geometry = new T.ExtrudeGeometry(shape, {
      depth: .085, bevelEnabled: true, bevelThickness: .016,
      bevelSize: .0065, bevelSegments: 4, steps: 1, curveSegments: 12
    });
    const mesh = new T.Mesh(geometry, [gold, edge]);
    (Math.max(...item.outer.map(point => point[0])) < 480 ? emblem : wordmark).add(mesh);
  }
  const center = new T.Vector3();
  const bounds = new T.Box3();
  for (const group of [emblem, wordmark]) {
    bounds.setFromObject(group).getCenter(center);
    for (const mesh of group.children) mesh.geometry.translate(-center.x, -center.y, -center.z);
    group.userData.originalCenter = center.clone();
  }

  function resize() {
    const width = stage.clientWidth, height = stage.clientHeight;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    logo.rotation.set(0, 0, 0);
    logo.position.set(0, 0, 0);
    for (const group of [emblem, wordmark]) {
      group.scale.setScalar(1);
      group.position.copy(group.userData.originalCenter);
    }
    if (width < 700 && height > width) {
      emblem.scale.setScalar(.85);
      emblem.position.set(0, .55, 0);
      wordmark.scale.setScalar(.43);
      wordmark.position.set(0, -2.65, 0);
    }
    bounds.setFromObject(logo).getCenter(center);
    emblem.position.sub(center);
    wordmark.position.sub(center);
    const size = bounds.getSize(new T.Vector3());
    camera.position.set(0, 0, Math.max(size.y / 2, size.x / (2 * camera.aspect)) * 1.3 / Math.tan(17 * Math.PI / 180) + 1);
    camera.updateProjectionMatrix();
    draw();
  }

  let time = reduced ? 4 : 0;
  let last = performance.now();
  let pointerX = 0, pointerY = 0;
  function draw() {
    const reveal = reduced ? 1 : 1 - Math.pow(1 - Math.min(time / 3.4, 1), 3);
    logo.rotation.y = (1 - reveal) * -.55 + (reduced ? 0 : Math.sin(time * .23) * .045 + pointerX);
    logo.rotation.x = reduced ? 0 : (1 - reveal) * .06 + pointerY;
    logo.position.y = reduced ? 0 : Math.sin(time * .4) * .035;
    light.position.x = reduced ? -3 : -5 + Math.sin(time * .38) * 9;
    renderer.render(scene, camera);
    document.body.classList.add('ready');
    window.__logoReady = true;
  }
  function frame(now) {
    if (stopped || document.hidden) return;
    time += Math.min((now - last) / 1000, .05);
    last = now;
    draw();
    if (!reduced) animation = requestAnimationFrame(frame);
  }
  function resume() {
    cancelAnimationFrame(animation);
    if (stopped || document.hidden) return;
    last = performance.now();
    draw();
    if (!reduced) animation = requestAnimationFrame(frame);
  }
  new ResizeObserver(resize).observe(stage);
  resize();
  addEventListener('pointermove', event => {
    if (reduced || event.pointerType === 'touch') return;
    pointerX = (event.clientX / innerWidth - .5) * .08;
    pointerY = (event.clientY / innerHeight - .5) * .04;
  });
  document.addEventListener('visibilitychange', resume);
  motionPreference.addEventListener('change', event => {
    reduced = event.matches;
    if (reduced) { time = 4; pointerX = pointerY = 0; }
    resume();
  });
  resume();
} catch {
  fallback();
  renderer?.dispose();
}

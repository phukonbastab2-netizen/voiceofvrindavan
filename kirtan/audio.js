// Original instrumental sketches; no third-party recordings or samples.
export const TRACKS = [
  { name: 'Radhe · A quiet offering', category: 'EVENING BHAJAN', detail: 'Flute, tanpura & gentle claps', bpm: 76, mode: 'clap', root: 261.63, notes: [0,4,7,9,7,4,2,0,2,4,7,4,2,0,-5,0] },
  { name: 'Hare Krishna · Together in song', category: 'COURTYARD KIRTAN', detail: 'Harmonium, mridanga & kartals', bpm: 102, mode: 'kirtan', root: 293.66, notes: [0,0,4,7,9,7,4,2,0,4,7,12,9,7,4,0] },
  { name: 'Radha Govind · A joyful return', category: 'A JOYFUL SANKIRTAN', detail: 'Bansuri, lively drums & hand cymbals', bpm: 132, mode: 'dance', root: 261.63, notes: [0,4,7,12,9,7,4,7,9,12,14,12,9,7,4,0] }
];

export class KirtanAudio {
  constructor() { this.index=0; this.playing=false; this.volume=.55; this.offset=0; this.nodes=new Set(); }
  async init() {
    if(this.context) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if(!AudioContext) throw new Error('This browser cannot play the instrumental demos. Please try a recent Chrome or Safari.');
    const context = this.context = new AudioContext();
    this.master=context.createGain(); this.master.gain.value=this.volume*.6;
    this.analyser=context.createAnalyser(); this.analyser.fftSize=256;
    this.data=new Uint8Array(this.analyser.frequencyBinCount);
    const limiter=context.createDynamicsCompressor(); limiter.threshold.value=-16; limiter.ratio.value=8;
    this.master.connect(limiter); limiter.connect(this.analyser); this.analyser.connect(context.destination);
    this.reverb=context.createConvolver();
    const impulse=context.createBuffer(2,context.sampleRate*1.3,context.sampleRate);
    let seed=7;
    for(let ch=0;ch<2;ch++){const data=impulse.getChannelData(ch);for(let i=0;i<data.length;i++){seed=(seed*1664525+1013904223)>>>0;data[i]=((seed/4294967296)*2-1)*Math.pow(1-i/data.length,3)*.25;}}
    this.reverb.buffer=impulse; const wet=context.createGain();wet.gain.value=.17;this.reverb.connect(wet);wet.connect(this.master);
    this.noise=context.createBuffer(1,context.sampleRate*.3,context.sampleRate);
    const n=this.noise.getChannelData(0);for(let i=0;i<n.length;i++)n[i]=Math.random()*2-1;
  }
  route(node, gain) {
    node.connect(gain);gain.connect(this.master);gain.connect(this.reverb);
    this.nodes.add(node);node.onended=()=>{this.nodes.delete(node);node.disconnect();gain.disconnect();};
  }
  tone(freq,time,duration,volume,type='sine') {
    const c=this.context,osc=c.createOscillator(),gain=c.createGain();osc.type=type;osc.frequency.value=freq;
    gain.gain.setValueAtTime(0,time);gain.gain.linearRampToValueAtTime(volume,time+.035);
    gain.gain.exponentialRampToValueAtTime(.0001,time+duration);
    this.route(osc,gain);osc.start(time);osc.stop(time+duration+.03);
  }
  flute(freq,time,duration,volume) {
    this.tone(freq,time,duration,volume);
    this.tone(freq*2,time,duration*.85,volume*.14);
    this.tone(freq*3,time,duration*.6,volume*.03);
  }
  drum(time,accent=1) {
    const c=this.context,osc=c.createOscillator(),gain=c.createGain();osc.frequency.setValueAtTime(160,time);osc.frequency.exponentialRampToValueAtTime(58,time+.15);
    gain.gain.setValueAtTime(.27*accent,time);gain.gain.exponentialRampToValueAtTime(.0001,time+.24);
    this.route(osc,gain);osc.start(time);osc.stop(time+.25);
  }
  cymbal(time,volume=.08) {
    const c=this.context,source=c.createBufferSource(),gain=c.createGain(),filter=c.createBiquadFilter();
    source.buffer=this.noise;filter.type='highpass';filter.frequency.value=5500;
    source.connect(filter);filter.connect(gain);gain.connect(this.master);
    gain.gain.setValueAtTime(volume,time);gain.gain.exponentialRampToValueAtTime(.0001,time+.14);
    this.nodes.add(source);source.onended=()=>{this.nodes.delete(source);source.disconnect();filter.disconnect();gain.disconnect();};
    source.start(time);source.stop(time+.16);
    this.tone(3320,time,.18,volume*.18);this.tone(4720,time,.13,volume*.1);
  }
  schedule() {
    if(!this.playing) return;
    const track=TRACKS[this.index], step=60/track.bpm/2, c=this.context;
    while(this.nextTime<c.currentTime+.15){
      const n=this.step,t=this.nextTime, beat=n/2;
      if(n%2===0){const note=track.notes[(n/2)%track.notes.length];this.flute(track.root*2**(note/12),t,step*1.85,.13);}
      if(n%8===0){this.tone(track.root/2,t,step*8,.11,'triangle');this.tone(track.root*.75,t,step*8,.07);}
      if(n%2===0)this.drum(t,n%8===0?1:.58);
      if(track.mode==='clap' ? n%4===2 : n%2===1)this.cymbal(t,track.mode==='dance'?.095:.055);
      if(track.mode==='dance' && n%4===3)this.drum(t,.32);
      if(track.mode==='kirtan' && n%4===0){this.tone(track.root,t,step*3,.035,'triangle');this.tone(track.root*1.5,t,step*3,.022,'triangle');}
      this.step++;this.nextTime+=step;
    }
  }
  async play() {
    await this.init();await this.context.resume();if(this.playing)return;
    this.playing=true;this.started=this.context.currentTime-this.offset;
    const stepSeconds=60/TRACKS[this.index].bpm/2;
    this.step=Math.floor(this.offset/stepSeconds);this.nextTime=this.context.currentTime+.05;
    this.schedule();this.timer=setInterval(()=>this.schedule(),35);
  }
  pause() {
    if(!this.context)return;
    this.offset=this.time;this.playing=false;clearInterval(this.timer);
    for(const node of this.nodes){try{node.stop();}catch{}}
    this.nodes.clear();
  }
  async select(index) {const resume=this.playing;this.pause();this.index=index;this.offset=0;if(resume)await this.play();}
  setVolume(value) {this.volume=value;if(this.master)this.master.gain.setTargetAtTime(value*.6,this.context.currentTime,.04);}
  get time() {return this.playing ? Math.max(0,this.context.currentTime-this.started) : this.offset;}
  get state() {
    if(!this.playing)return {playing:false,energy:0,beat:0,mode:'idle',bpm:TRACKS[this.index].bpm,bars:[]};
    this.analyser.getByteFrequencyData(this.data);
    const energy=this.data.reduce((a,b)=>a+b,0)/(this.data.length*255);
    return {playing:true,energy,beat:this.time*TRACKS[this.index].bpm/60,mode:TRACKS[this.index].mode,bpm:TRACKS[this.index].bpm,bars:Array.from(this.data.slice(1,9),n=>n/255)};
  }
  dispose(){this.pause();this.context?.close();}
}

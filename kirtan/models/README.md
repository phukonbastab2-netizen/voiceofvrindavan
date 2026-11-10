# Your character models go here later

No human models are included in this version, at the owner's request.

When ready, add an owned/licensed `.glb` file here and configure `/kirtan/characters.json`. Use a rigged model with the desired dance/clap/kirtan animations embedded. The loader plays your supplied animation clips; it does not invent authentic raas footwork from a static model.

Supported by the current self-hosted GLTFLoader: ordinary GLB geometry/skins/animations and PNG, JPEG or WebP textures. Draco/Meshopt-compressed models require their corresponding decoder integrations before use.

Example configuration:

```json
{
  "characters": [
    {
      "id": "performer",
      "url": "/kirtan/models/my-performer.glb",
      "height": 2.65,
      "position": [0, 0.21, 0],
      "rotationY": 0,
      "animationBpm": 100,
      "clips": {
        "idle": "Idle",
        "dance": "Raas",
        "clap": "Clapping",
        "kirtan": "Kirtan"
      }
    }
  ]
}
```

Use the exact embedded clip names. Missing movement clips fall back to Idle when provided; a model without animation clips remains static. Height is fitted through a separate wrapper so the model's animation transforms remain intact. Its feet are aligned to the stage at y=0.21. Set `animationBpm` to the tempo of the supplied motion to synchronize its playback with the selected instrumental demo.

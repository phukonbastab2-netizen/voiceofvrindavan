# Voice of Vrindavan

Conversation website for the fine-tuned Qwen3 8B belief model.

Cloudflare Pages serves `index.html`. The Pages Function at `/api/chat` forwards requests to the private GPU model service, keeping its API key out of browser code.

Required Cloudflare Pages secrets:

- `MODEL_API_URL`: HTTPS address of the GPU chat API, without `/chat`
- `MODEL_API_KEY`: same value as `CHAT_API_KEY` on the GPU service

The GPU service must be deployed separately from Cloudflare Pages because the model requires an NVIDIA GPU.

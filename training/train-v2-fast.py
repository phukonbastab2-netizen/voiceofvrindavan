"""Single-NVIDIA-GPU QLoRA using Unsloth and Hugging Face Trainer."""
import argparse
import importlib.util
import json
import math
import subprocess
from pathlib import Path


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--config", default="config.json")
    p.add_argument("--mode", choices=["sanity", "full"], default="sanity")
    p.add_argument("--output-dir")
    p.add_argument("--resume-from-checkpoint")
    a = p.parse_args()
    cfg = json.loads(Path(a.config).read_text())
    out = Path(a.output_dir or f"runs/{a.mode}")
    out.mkdir(parents=True, exist_ok=True)
    def blocked(reason):
        (out / "status.json").write_text(json.dumps({"status": "blocked", "reason": reason}, indent=2))
        raise SystemExit(reason)
    if importlib.util.find_spec("torch") is None:
        blocked("PyTorch is not installed. A CUDA-enabled NVIDIA environment is required; no training ran.")
    # Import Unsloth before torch/transformers to apply its patches.
    if importlib.util.find_spec("unsloth") is None:
        blocked("Unsloth is not installed; run the GPU setup commands in README.md.")
    from unsloth import FastLanguageModel, is_bfloat16_supported
    import torch
    if not torch.cuda.is_available():
        blocked("CUDA GPU unavailable; no training ran.")
    from datasets import Dataset
    from transformers import Trainer, TrainingArguments, DataCollatorForSeq2Seq, TrainerCallback
    from prepare_data import read_rows
    from encoding import encode_row
    if (out / "adapter").exists() and not a.resume_from_checkpoint:
        raise SystemExit("Output already has an adapter. Choose another --output-dir or resume a checkpoint.")
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=cfg["model"], revision=cfg.get("revision"), max_seq_length=cfg["max_length"],
        dtype=None, load_in_4bit=True,
    )
    # A second-stage run can load the existing adapter directly. Only create new
    # LoRA layers when starting from a base model.
    if not getattr(model, "peft_config", None):
        model = FastLanguageModel.get_peft_model(
            model, r=cfg["lora_r"], lora_alpha=cfg["lora_alpha"], lora_dropout=0, bias="none",
            target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
            use_gradient_checkpointing="unsloth", random_state=cfg["seed"],
        )
    tokenizer.padding_side = "right"
    def dataset(split, limit):
        rows = read_rows(Path(cfg["data_dir"]) / f"{split}.jsonl")
        if limit:
            import random
            random.Random(cfg["seed"]).shuffle(rows)
            rows = rows[:limit]
        return Dataset.from_list([encode_row(row, tokenizer, cfg["max_length"]) for row in rows])
    sanity = a.mode == "sanity"
    training = dataset("train", 32 if sanity else None)
    # A fixed validation sample keeps full-run metrics useful without spending
    # most of the paid GPU time on repeated evaluation.
    validation = dataset("validation", 16 if sanity else 64)
    bf16 = is_bfloat16_supported()
    args = TrainingArguments(
        output_dir=str(out), per_device_train_batch_size=cfg["batch_size"],
        per_device_eval_batch_size=1, gradient_accumulation_steps=1 if sanity else cfg["gradient_accumulation_steps"],
        max_steps=5 if sanity else -1, num_train_epochs=cfg["epochs"],
        learning_rate=cfg["learning_rate"], warmup_ratio=0.03, lr_scheduler_type="linear",
        weight_decay=0.01, optim="adamw_8bit", fp16=not bf16, bf16=bf16,
        logging_steps=1 if sanity else 10, logging_nan_inf_filter=False,
        eval_strategy="no" if sanity else "steps", eval_steps=100,
        save_strategy="no" if sanity else "steps", save_steps=100, save_total_limit=2,
        load_best_model_at_end=not sanity, metric_for_best_model="eval_loss", greater_is_better=False,
        prediction_loss_only=True, report_to="none", seed=cfg["seed"], data_seed=cfg["seed"],
    )
    class FiniteLoss(TrainerCallback):
        def on_log(self, args, state, control, logs=None, **kwargs):
            for key in ("loss", "eval_loss", "grad_norm"):
                if key in (logs or {}) and not math.isfinite(float(logs[key])):
                    raise RuntimeError(f"Non-finite {key}; training aborted")
    trainer = Trainer(model=model, args=args, train_dataset=training, eval_dataset=validation,
        processing_class=tokenizer, data_collator=DataCollatorForSeq2Seq(tokenizer, padding=True, label_pad_token_id=-100),
        callbacks=[FiniteLoss()])
    metadata = {"config": cfg, "mode": a.mode, "gpu": torch.cuda.get_device_name(0),
        "model_commit": getattr(model.config, "_commit_hash", None), "training_rows": len(training), "validation_rows": len(validation)}
    (out / "run_config.json").write_text(json.dumps(metadata, indent=2))
    (out / "environment.txt").write_text(subprocess.check_output([__import__("sys").executable, "-m", "pip", "freeze"], text=True))
    before = trainer.evaluate()
    metrics = trainer.train(resume_from_checkpoint=a.resume_from_checkpoint).metrics
    after = trainer.evaluate()
    if not math.isfinite(metrics["train_loss"]):
        raise RuntimeError("Non-finite training loss")
    # Nonzero LoRA B weights provide evidence that optimizer steps changed the adapter.
    changed = any(p.detach().float().abs().sum().item() > 0 for name, p in model.named_parameters() if "lora_B" in name)
    if not changed:
        raise RuntimeError("No nonzero LoRA B weights after training")
    adapter = out / "adapter"
    model.save_pretrained(str(adapter))
    tokenizer.save_pretrained(str(adapter))
    trainer.save_state()
    status = {"status": "completed", "optimizer_steps": trainer.state.global_step, "adapter_updated": changed,
        "before_validation": before, "training": metrics, "after_validation": after,
        "note": "Sanity execution is not proof of behavioral improvement; test split was not used."}
    (out / "status.json").write_text(json.dumps(status, indent=2))
    print(json.dumps(status, indent=2))


if __name__ == "__main__":
    main()

# Isle Local Gemma

A local extension of Isle 1.7.1: open the island and choose **Ask locally**, or press **Ctrl+Alt+I**. The shortcut can be changed in Isle Settings → Assistant → Local Gemma.

The chat expands inside the island itself, with a compact Ask Isle header, rounded composer and monochrome message styling. There is no separate dialog or dimmed desktop. Type a question and press Enter. Responses stream into the panel. **Screen** takes one image of the current monitor after hiding the panel. A preview appears; the image reaches the model only after **↑ (Send)**. **Remove** discards an unsent image. Follow-up questions share the conversation, including an attached image, until the context resets. **× (Close and clear)** and **Escape** terminate the model process and clear the conversation. **↺ (New chat / Stop)** cancels work and reloads the model for a fresh chat.

## Implementation

- Rust inference with mistral.rs, pinned at `fb4cdc3730dc64b366724e7637a205a8b7747499`.
- Gemma 4 E2B instruction-tuned, Q4_K_M GGUF and F16 vision projector. Tokenizer and processor configuration are also bundled locally. Exact revisions, sizes and SHA-256 hashes are in `model-source.json`.
- CPU execution, four Rayon threads, 4096-token context, up to 256 output tokens, thinking disabled. The compact context clears after four completed exchanges; the panel tells you when it does. A very long request can still exceed the context and return an error.
- The UI uses native GNOME Shell JavaScript, as Isle already does. No TypeScript, browser, Node runtime or HTTP server is required for chat.
- JSON messages travel over subprocess pipes. Screenshots use `Gio.MemoryOutputStream`, with no screenshot files. The model does not get filesystem, command-execution, browser or cloud tools.

## Privacy boundary

The Rust executable installs an inherited Linux seccomp filter before creating worker threads or loading the model. It refuses startup if enforcement fails. It blocks socket creation, external connections, listening, and io_uring setup. Only private Unix socket pairs are allowed for internal runtime notifications. It rejects the x32 ABI, and requires Linux x86_64. There is no cloud fallback. The GNOME launcher does not pass network descriptors. The production launcher disables core dumps and suppresses library stderr. Chat and screen content are not intentionally written to history files. This is not a claim that operating-system memory, swap, or the rest of the computer has no records.

Initial downloads require internet access. Other existing Isle features and other applications retain their own behavior; this filter protects the local inference process. The original cloud assistant remains a separate control.

## Build and install

Requires Linux x86_64, GNOME 46–51, an existing Isle installation, Rust 1.95+, Python 3, Git, and a C/C++ build toolchain. This setup is intended for the tested GNOME 50 desktop; other GNOME versions require UI validation.

From the repository root:

```sh
./scripts/build-local-ai.sh
python3 local-ai/download-model.py /path/to/gemma4-models
./scripts/install-local-ai.sh /path/to/gemma4-models
```

The build script uses a sibling `mistral-rs` checkout at the pinned revision. The installation goes to `~/.local/share/isle-local` and the existing Isle extension. The installer saves the prior extension under `~/.local/share/isle-local/backups`. GNOME 50 caches extension modules: **sign out and sign back in once** to load the change. Do not restart the Wayland compositor in place.

Run the independent network-enforcement check:

```sh
~/.local/share/isle-local/bin/isle-local-ai --check-privacy
```

The runner also accepts newline-delimited JSON on stdin: `{"text":"Hello"}` or `{"text":"What is shown?","image":"<base64 PNG>"}`. Output lines beginning `ISLE_LOCAL:` carry loading, ready, delta, answer, error and context-reset events.

## Rollback

Copy the saved `extension` directory from the installer-reported backup back to `~/.local/share/gnome-shell/extensions/isle@zickrian.github.io`, then sign out and sign back in. Existing Isle daemon binaries and cloud-provider settings are unchanged by this installer. Keep a backup of the modified extension before restoring if you want to return to it.

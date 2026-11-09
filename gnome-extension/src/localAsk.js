// SPDX-License-Identifier: GPL-3.0-or-later
// Local, memory-only chat. The Rust child enforces offline mode before loading Gemma.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';
import 'resource:///org/gnome/shell/ui/screenshot.js';
import {VERTICAL} from './compat.js';

export class LocalAsk {
    constructor(extension) {
        this._extension = extension;
        this._generation = 0;
        this._dialog = new ModalDialog.ModalDialog({styleClass: 'isle-local-dialog', destroyOnClose: false,
            shouldFadeIn: false, shouldFadeOut: false});
        this._dialog.dialogLayout.y_align = Clutter.ActorAlign.START;
        this._dialog.dialogLayout.set_style('margin-top: 40px;');
        const body = this._dialog.contentLayout;
        body.add_child(new St.Label({text: 'Ask locally', style_class: 'isle-local-title'}));
        this._status = new St.Label({text: 'Gemma 4 · Offline · No saved chat', style_class: 'isle-local-status'});
        this._status.clutter_text.line_wrap = true;
        body.add_child(this._status);
        const scroll = new St.ScrollView({style_class: 'isle-local-scroll', x_expand: true});
        this._messages = new St.BoxLayout({...VERTICAL, style_class: 'isle-local-messages', x_expand: true});
        scroll.set_child(this._messages);
        body.add_child(scroll);
        this._scroll = scroll;
        this._add('Isle', 'Ask a question, or attach a screen image and ask about what you see. Nothing is captured until you press Attach screen.');
        this._preview = new St.Icon({icon_size: 80, visible: false, accessible_name: 'Attached screen preview'});
        body.add_child(this._preview);
        const attachmentRow = new St.BoxLayout({style_class: 'isle-local-row'});
        this._captureButton = this._button('Attach screen', () => this._capture());
        this._removeButton = this._button('Remove image', () => this._removeImage());
        this._removeButton.hide();
        attachmentRow.add_child(this._captureButton);
        attachmentRow.add_child(this._removeButton);
        body.add_child(attachmentRow);
        this._entry = new St.Entry({hint_text: 'Ask Gemma…', can_focus: true, x_expand: true,
            style_class: 'isle-local-entry'});
        this._entry.clutter_text.connect('activate', () => this._send());
        body.add_child(this._entry);
        this._dialog.setInitialKeyFocus(this._entry);
        this._dialog.setButtons([
            {label: 'Close & clear', action: () => this.close(), key: Clutter.KEY_Escape},
            {label: 'New chat / Stop', action: () => this._reset()},
            {label: 'Send', action: () => this._send(), default: true},
        ]);
    }
    _button(label, action) {
        const button = new St.Button({label, can_focus: true, style_class: 'isle-local-button'});
        button.connect('clicked', action);
        return button;
    }
    _add(who, text) {
        const label = new St.Label({text: `${who}\n${text}`, style_class: 'isle-local-message', x_expand: true});
        label.clutter_text.line_wrap = true;
        label.clutter_text.ellipsize = 0;
        label.clutter_text.set_selectable(true);
        this._messages.add_child(label);
        // Bound rendered history as well as the model's context.
        if (this._messages.get_n_children() > 12)
            this._messages.get_first_child().destroy();
        const adjustment = this._scroll.vadjustment;
        if (adjustment)
            adjustment.value = Math.max(0, adjustment.upper - adjustment.page_size);
        return label;
    }
    open() {
        this._dialog.open();
        this._start();
    }
    _start() {
        if (this._process)
            return;
        const launcher = this._extension.path + '/local-ai/run';
        if (!GLib.file_test(launcher, GLib.FileTest.IS_EXECUTABLE)) {
            this._status.text = 'Local runner is not installed. Run the local setup first.';
            return;
        }
        try {
            const spawn = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.STDIN_PIPE |
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE});
            spawn.setenv('HF_HUB_OFFLINE', '1', true);
            spawn.setenv('HF_HUB_DISABLE_TELEMETRY', '1', true);
            spawn.setenv('RAYON_NUM_THREADS', '4', true);
            this._process = spawn.spawnv([launcher]);
            this._input = this._process.get_stdin_pipe();
            this._output = new Gio.DataInputStream({base_stream: this._process.get_stdout_pipe()});
            this._status.text = 'Loading Gemma 4 locally…';
            const generation = ++this._generation;
            this._read(generation);
        } catch (_error) {
            this._status.text = 'Could not start local Gemma. Check the local installation.';
            this._kill();
        }
    }
    _read(generation) {
        if (generation !== this._generation || !this._output)
            return;
        this._output.read_line_async(GLib.PRIORITY_DEFAULT, null, (stream, result) => {
            if (generation !== this._generation)
                return;
            try {
                const [line] = stream.read_line_finish_utf8(result);
                if (line === null) {
                    this._ready = false;
                    this._busy = false;
                    this._status.text = this._lastError ?? 'Local runner stopped. Reopen to try again.';
                    this._kill();
                    return;
                }
                if (line.startsWith('ISLE_LOCAL:'))
                    this._event(JSON.parse(line.slice(11)));
                this._read(generation);
            } catch (_error) {
                this._status.text = 'Local response could not be read. Reopen to try again.';
                this._kill();
            }
        });
    }
    _event(event) {
        if (event.event === 'ready') {
            this._ready = true;
            this._status.text = 'Gemma 4 · Network blocked · Ready';
        } else if (event.event === 'loading') {
            this._status.text = 'Loading Gemma 4 locally…';
        } else if (event.event === 'delta') {
            this._draftText = (this._draftText ?? '') + event.text;
            this._draftLabel ??= this._add('Gemma', '');
            this._draftLabel.text = `Gemma\n${this._draftText}`;
        } else if (event.event === 'answer') {
            this._busy = false;
            this._status.text = 'Gemma 4 · Network blocked · Ready';
            if (this._draftLabel)
                this._draftLabel.text = `Gemma\n${event.text}`;
            else
                this._add('Gemma', event.text);
            this._draftLabel = null;
            this._draftText = '';
        } else if (event.event === 'error') {
            this._busy = false;
            this._lastError = event.message;
            this._status.text = 'Local request failed';
            this._add('Error', event.message);
        } else if (event.event === 'context_reset') {
            this._add('Isle', 'Older context was cleared to keep memory use small. Attach the screen again if needed.');
        }
    }
    _send() {
        const text = this._entry.text.trim();
        if (!text || this._busy || !this._ready || this._capturing)
            return;
        if (new TextEncoder().encode(text).length > 8000) {
            this._status.text = 'Please shorten this question.';
            return;
        }
        this._busy = true;
        this._status.text = 'Thinking on this computer…';
        this._lastError = null;
        this._draftLabel = null;
        this._draftText = '';
        const request = new TextEncoder().encode(JSON.stringify({text, image: this._image ?? null}) + '\n');
        this._add('You', text + (this._image ? '\n[Screen image attached]' : ''));
        this._entry.text = '';
        this._removeImage();
        const generation = this._generation;
        this._input.write_all_async(request, GLib.PRIORITY_DEFAULT, null, (stream, result) => {
            if (generation !== this._generation)
                return;
            try {
                stream.write_all_finish(result);
            } catch (_error) {
                this._status.text = 'Could not send the local request. Reopen to try again.';
                this._kill();
            }
        });
    }
    async _capture() {
        if (this._busy || this._capturing)
            return;
        this._capturing = true;
        const generation = this._generation;
        const monitor = Main.layoutManager.currentMonitor;
        this._dialog.close();
        // Let the island and chat disappear before capturing the chosen monitor.
        this._captureTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
            this._captureTimer = 0;
            this._takeScreen(monitor, generation);
            return GLib.SOURCE_REMOVE;
        });
    }
    async _takeScreen(monitor, generation) {
        try {
            const stream = Gio.MemoryOutputStream.new_resizable();
            const shot = new Shell.Screenshot();
            await shot.screenshot_area(monitor.x, monitor.y, monitor.width, monitor.height, stream);
            stream.close(null);
            if (generation !== this._generation)
                return;
            const bytes = stream.steal_as_bytes();
            if (bytes.get_size() > 10_000_000)
                throw new Error('Screen image is too large. Try a smaller display resolution.');
            this._image = GLib.base64_encode(bytes.get_data());
            this._preview.gicon = new Gio.BytesIcon({bytes});
            this._preview.show();
            this._removeButton.show();
            this._status.text = 'Screen image attached · Sent only when you press Send';
        } catch (_error) {
            if (generation === this._generation)
                this._status.text = 'Screen capture failed. Try again after unlocking the desktop.';
        } finally {
            if (generation === this._generation) {
                this._capturing = false;
                this._dialog.open();
            }
        }
    }
    _removeImage() {
        this._image = null;
        this._preview.gicon = null;
        this._preview.hide();
        this._removeButton.hide();
    }
    _kill() {
        ++this._generation;
        if (this._captureTimer)
            GLib.source_remove(this._captureTimer);
        this._captureTimer = 0;
        this._capturing = false;
        this._process?.force_exit();
        this._process = null;
        this._input = null;
        this._output = null;
        this._ready = false;
        this._busy = false;
        this._draftLabel = null;
        this._draftText = '';
    }
    _reset() {
        this._kill();
        this._removeImage();
        this._messages.destroy_all_children();
        this._entry.text = '';
        this._lastError = null;
        this._start();
    }
    close() {
        this._kill();
        this._removeImage();
        this._messages.destroy_all_children();
        this._entry.text = '';
        this._lastError = null;
        this._dialog.close();
    }
    destroy() {
        this.close();
        this._dialog.destroy();
    }
}

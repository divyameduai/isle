import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../../gnome-extension/src/localAsk.js', import.meta.url), 'utf8')
    .replace(/^import .*;\n/gm, '').replace('export class LocalAsk', 'globalThis.LocalAsk = class LocalAsk');
function setup() {
    const context = {TextEncoder, GLib: {PRIORITY_DEFAULT: 0, source_remove() {}},
        Main: {layoutManager: {currentMonitor: {x:0,y:0,width:100,height:100}}}};
    vm.runInNewContext(source, context);
    const app = Object.create(context.LocalAsk.prototype);
    Object.assign(app, {_ready:true, _busy:false, _generation:1, _entry:{text:'Explain this'},
        _status:{text:''}, _preview:{hide(){}, gicon:null}, _removeButton:{hide(){}},
        _messages:{destroy_all_children(){}}, _dialog:{close(){}}, _add(){}});
    return {app, context};
}
test('ordinary Send has no screen capture and sends no image', () => {
    const {app} = setup();
    let payload;
    app._input = {write_all_async(bytes) {payload = JSON.parse(new TextDecoder().decode(bytes));}};
    app._capture = () => {throw new Error('unrequested capture');};
    app._send();
    assert.deepEqual(payload, {text:'Explain this',image:null});
});
test('an attached screen is sent once, then removed from the composer', () => {
    const {app} = setup();
    let payload;
    app._image = 'image-bytes';
    app._input = {write_all_async(bytes) {payload = JSON.parse(new TextDecoder().decode(bytes));}};
    app._send();
    assert.equal(payload.image, 'image-bytes');
    assert.equal(app._image, null);
});
test('Send is blocked while loading, capturing, or already generating', () => {
    for (const state of [{_ready:false},{_busy:true},{_capturing:true}]) {
        const {app} = setup(); Object.assign(app,state);
        app._input={write_all_async(){throw new Error('unexpected send');}};
        app._send(); assert.equal(app._entry.text,'Explain this');
    }
});
test('closing terminates inference, clears images and invalidates pending capture', () => {
    const {app} = setup(); let killed = false;
    app._process={force_exit(){killed=true;}};
    app._image='private'; app._capturing=true;
    app.close();
    assert.equal(killed,true); assert.equal(app._image,null);
    assert.equal(app._entry.text,''); assert.equal(app._ready,false);
    assert.equal(app._generation,2);
});
test('late process callbacks cannot update a closed chat', () => {
    const {app} = setup(); let callback;
    app._output={read_line_async(_p,_c,cb){callback=cb;}};
    app._read(1); app.close();
    callback({read_line_finish_utf8(){throw new Error('stale read');}},{});
});

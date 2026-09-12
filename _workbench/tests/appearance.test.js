const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../public/appearance.js'), 'utf8');
function boot(storage, blocked = false) {
  const events = {}, controlEvents = {}, windowEvents = {};
  const root = {dataset:{}};
  const control = {value:'', addEventListener:(name, fn) => { controlEvents[name] = fn; }};
  const note = {value:'尚未儲存的訪談筆記'}, question = {value:'正在輸入的追問'};
  const elements = {uiAppearance:control, notesTa:note, aiQ:question};
  const context = {
    document:{documentElement:root, addEventListener:(name, fn) => { events[name] = fn; }, getElementById:id => elements[id]},
    window:{addEventListener:(name, fn) => { windowEvents[name] = fn; }, location:{reload:() => assert.fail('Switch must not reload')}},
    localStorage:{getItem:k => { if(blocked) throw Error('blocked'); return storage.get(k) ?? null; }, setItem:(k,v) => { if(blocked) throw Error('blocked'); storage.set(k,v); }},
  };
  vm.runInNewContext(source, context);
  const beforeReady = root.dataset.ui;
  events.DOMContentLoaded();
  return {root,control,beforeReady,note,question,change:value => { control.value=value; controlEvents.change(); }, storage:event => windowEvents.storage(event)};
}
test('appearance switches without replacing unsaved inputs and persists across reloads', () => {
  const storage = new Map([['dd-active-case','Acme'],['dd-chat:Acme','conversation-1']]);
  const ui = boot(storage);
  assert.equal(ui.beforeReady, 'classic');
  ui.change('modern');
  assert.equal(ui.root.dataset.ui,'modern');
  assert.equal(ui.note.value,'尚未儲存的訪談筆記');
  assert.equal(ui.question.value,'正在輸入的追問');
  assert.equal(storage.get('dd-chat:Acme'),'conversation-1');
  assert.equal(storage.get('dd-active-case'),'Acme');
  const reopened = boot(storage);
  assert.equal(reopened.beforeReady,'modern');
  assert.equal(reopened.control.value,'modern');
  reopened.change('classic');
  assert.equal(boot(storage).beforeReady,'classic');
});
test('invalid preferences and blocked storage do not prevent switching', () => {
  assert.equal(boot(new Map([['dd-ui-appearance','invalid']])).beforeReady,'classic');
  const ui = boot(new Map(), true);
  ui.change('modern');
  assert.equal(ui.root.dataset.ui,'modern');
  ui.change('classic');
  assert.equal(ui.control.value,'classic');
});
test('other tabs synchronize only appearance and reset safely after storage is cleared', () => {
  const ui = boot(new Map());
  ui.storage({key:'dd-ui-appearance',newValue:'modern'});
  assert.equal(ui.root.dataset.ui,'modern');
  assert.equal(ui.control.value,'modern');
  ui.storage({key:'dd-active-case',newValue:'Another case'});
  assert.equal(ui.control.value,'modern');
  ui.storage({key:null,newValue:null});
  assert.equal(ui.root.dataset.ui,'classic');
});

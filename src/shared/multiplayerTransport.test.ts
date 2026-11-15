import test from 'node:test';
import assert from 'node:assert/strict';
import { MultiplayerClient } from '../game/multiplayer';

function client() {
  return Object.assign(Object.create(MultiplayerClient.prototype), {
    id: 'guest', hostId: 'host', usingRelay: false, relayPeers: new Set(), peers: new Map(),
  }) as any;
}

test('late direct connection upgrades a relayed join instead of staying on the slower fallback', () => {
  const c = client();
  c.usingRelay = true;
  c.pendingJoin = { code: 'ABCDEF', playerName: 'Pilot' };
  const messages: any[] = [];
  const peer = { channel: { readyState: 'open', send: (value: string) => messages.push(JSON.parse(value)) }, stateChannel: { readyState: 'open' } };
  c.activateDirectChannel('host', peer);
  assert.equal(c.usingRelay, false);
  assert.deepEqual(messages.map((message) => message.event), ['transport:p2p', 'join']);
});

test('transient input never queues behind reliable messages and congested state channels drop old frames', () => {
  const c = client();
  const reliable: string[] = [], transient: string[] = [];
  const peer = { channel: { readyState: 'open', send: (value: string) => reliable.push(value) }, stateChannel: { readyState: 'connecting', bufferedAmount: 0, send: (value: string) => transient.push(value) } };
  c.peers.set('host', peer);
  c.sendPeer('host', 'player:input', {}, true);
  assert.equal(reliable.length, 0);
  peer.stateChannel.readyState = 'open';
  peer.stateChannel.bufferedAmount = 4096;
  c.sendPeer('host', 'player:input', {}, true);
  assert.equal(transient.length, 0);
  peer.stateChannel.bufferedAmount = 0;
  c.sendPeer('host', 'player:input', {}, true);
  assert.equal(transient.length, 1);
  c.sendPeer('host', 'room:leave');
  assert.equal(reliable.length, 1);
});

test('disconnected relay cannot create a flood of HTTP fallback requests', () => {
  const c = client();
  let sends = 0;
  let connected = false;
  c.relayReady = true;
  c.supabase = { realtime: { isConnected: () => connected } };
  c.roomChannel = { state: 'joined', send: () => { sends++; return Promise.resolve('ok'); } };
  c.sendRoomRelay('game:state:c', {});
  assert.equal(sends, 0);
  connected = true;
  c.roomChannel.state = 'errored';
  c.sendRoomRelay('game:state:c', {});
  assert.equal(sends, 0);
  c.roomChannel.state = 'joined';
  c.sendRoomRelay('game:state:c', {});
  assert.equal(sends, 1);
});

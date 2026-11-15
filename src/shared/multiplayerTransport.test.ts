import test from 'node:test';
import assert from 'node:assert/strict';
import { MultiplayerClient } from '../game/multiplayer';

function client() {
  return Object.assign(Object.create(MultiplayerClient.prototype), {
    id: 'guest', hostId: 'host', usingRelay: false, relayPeers: new Set(), peers: new Map(), inputRelays: new Map(), handlers: new Map(),
  }) as any;
}

test('late direct connection upgrades a relayed join instead of staying on the slower fallback', () => {
  const c = client();
  c.usingRelay = true;
  c.pendingJoin = { code: 'ABCDEF', playerName: 'Pilot' };
  const messages: any[] = [];
  const peer = { channel: { readyState: 'open', send: (value: string) => messages.push(JSON.parse(value)) }, stateChannel: { readyState: 'open' } };
  c.activateDirectChannel('host', peer);
  assert.equal(c.usingRelay, true, 'Do not abandon the working relay until the host acknowledges');
  c.peers.set('host', peer);
  c.onPeerMessage('host', { event: 'transport:ready' }, true);
  assert.equal(c.usingRelay, false);
  assert.deepEqual(messages.map((message) => message.event), ['transport:p2p', 'join']);
});

test('discovery channel interruptions cannot emit the match disconnect that sends users to the lobby', () => {
  for (const status of ['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED']) {
    for (const isHost of [false, true]) {
      const c = client();
      if (isHost) c.id = 'host';
      c.connected = true;
      c.room = { code: 'ABCDEF', inProgress: true };
      c.simulation = { active: true };
      const fired: string[] = [];
      c.fire = (event: string) => fired.push(event);
      c.onSignalStatus(status);
      assert.deepEqual(fired, ['signaling:status']);
      assert.equal(c.room.code, 'ABCDEF');
      assert.equal(c.simulation.active, true);
      c.onSignalStatus('SUBSCRIBED');
      assert.equal(c.connected, true);
      assert.equal(fired.includes('disconnect'), false);
    }
  }
});

test('failed late WebRTC negotiation cannot kick a player already connected by relay', () => {
  const c = client();
  c.usingRelay = true;
  c.room = { code: 'ABCDEF' };
  c.peerLeft = () => assert.fail('A failed transport must not remove room membership');
  let closed = 0;
  const peer = { pc: { close: () => closed++ } };
  c.peers.set('host', peer);
  c.handleDirectFailure('host', peer);
  assert.equal(c.usingRelay, true);
  assert.equal(c.room.code, 'ABCDEF');
  assert.equal(closed, 1);
});

test('late direct traffic does not switch routes and relay inputs go only to their player topic', () => {
  const c = client();
  c.usingRelay = true;
  c.onPeerMessage('host', { event: 'pong', payload: { t: performance.now() } }, true);
  assert.equal(c.usingRelay, true);
  let sent = 0;
  c.supabase = { realtime: { isConnected: () => true } };
  c.inputRelays.set('guest', { state: 'joined', send: () => { sent++; return Promise.resolve('ok'); } });
  c.sendRoomRelay = () => assert.fail('Input must not fan out to every room subscriber');
  c.sendPeer('host', 'player:input', { seq: 1, input: {} }, true);
  assert.equal(sent, 1);
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

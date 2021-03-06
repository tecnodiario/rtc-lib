import { EventEmitter } from 'events';

import {WebSocketChannel} from './signaling/web_socket_channel';
import {MucSignaling} from './signaling/muc_signaling';

import { RemotePeer } from './remote_peer';
import { LocalPeer } from './local_peer';
import { PeerConnection } from './peer_connection';

import { Signaling, SignalingPeer } from './types';
import { Peer } from './peer';

export type RoomState = "idle" | "connecting" | "connected" | "closed" | "failed";

/**
 * @module rtc
 */
/**
 * A virtual room which connects multiple Peers
 * @class rtc.Room
 *
 * @constructor
 * @param {String} name The name of the room. Will be passed on to signaling
 * @param {rtc.Signaling | String} signaling The signaling to be used. If you pass a string it will be interpreted as a websocket address and a palava signaling connection will be established with it.
 * @param {Object} [options] Various options to be used in connections created by this room
 * @param {Boolean} [options.auto_connect=true] Whether remote peers are connected automatically or an explicit `RemotePeer.connect()` call is needed
 * @param {String} [options.stun] The URI of the STUN server to use
 * @param {rtc.LocalPeer} [options.local] The local user
 */
export class Room<SP extends SignalingPeer = SignalingPeer, S extends Signaling<SP> = Signaling<SP>> extends EventEmitter {
  signaling: S;
  options: Record<string,any>
  local: LocalPeer;
  peers: Record<string,RemotePeer>;
  join_p?: Promise<void>;
  state: RoomState = "idle";

  /**
   * A new peer is encountered in the room. Fires on new remote peers after joining and for all peers in the room when joining.
   * @event peer_jopined
   * @param {rtc.RemotePeer} peer The new peer
   */

  /**
   * A peer left the room.
   * @event peer_left
   * @param {rtc.RemotePeer} peer The peer which left
   */

  /**
   * A peer changed its status.
   * @event peer_status_changed
   * @param {rtc.RemotePeer} peer The peer which changed its status
   * @param {Object} status The new status
   */

  /**
   * The connection to the room was closed
   * @event closed
   */

  /**
   * The underlying signaling implementation as provided in constructor
   * @property signaling
   * @type rtc.signaling.Signaling
   */

  /**
   * The local peer
   * @property local
   * @type rtc.LocalPeer
   */

  constructor(signaling: S, options: Record<string,any>) {
      super();
    // turn signaling into acctual signaling if needed
    if (options == null) { options = {}; }
    this.options = options;
    this.signaling = signaling;

    signaling.on("peer_joined", () => null); 

    this.local = this.options.local || new LocalPeer();

    this.signaling.setStatus(this.local._status);

    this.signaling.on('closed', () => {
      this.peers = {};
      this.emit('closed');

      if(this.state === "connected") {
        this.setState("closed");
      }
    });

    this.local.on('status_changed', () => {
      this.signaling.setStatus(this.local._status);
    });

    this.signaling.on('peer_joined', signaling_peer => {
      const pc = new PeerConnection(signaling_peer.first, this.options);
      const peer = this.createPeer(pc, signaling_peer);

      peer.on('status_changed', status => {
        this.emit('peer_status_changed', peer, status);
      });

      peer.on('left', () => {
        delete this.peers[signaling_peer.id];
        this.emit('peer_left', peer);
        this.emit('peers_changed', this.peers);
      });

      peer.on('message', data => {
        this.emit('peer_message', peer, data);
      });

      this.peers[signaling_peer.id] = peer;
      this.emit('peer_joined', peer, signaling_peer.id);
      this.emit('peers_changed', this.peers);

      peer.on('closed', () => {
        // TODO
        //delete this.peers[signaling_peer.id];
    });
  });

    this.peers = {};
  }


  /**
   * Joins the room. Initiates connection to signaling server if not done before.
   * @method join
   * @return {Promise} A promise which will be resolved once the room was joined
   */
  connect() {
    if (this.join_p == null) {
      this.setState("connecting");
      this.join_p = this.signaling.connect();
    }

    return this.join_p.then(() => {
      this.setState("connected");
    }).catch((err) => {
      this.setState("failed");
      throw err;
    });
  }


  /**
   * Leaves the room and closes all established peer connections
   * @method leave
   */
  leave() {
    return this.signaling.close();
  }


  /**
   * Cleans up all resources used by the room.
   * @method leave
   */
  destroy() {
    // TODO ...
    return this.signaling.close();
  }


  /**
   * Creates a remote peer. Overwrite to use your own class for peers.
   * @private
   * @method create_peer
   * @param {rtc.PeerConnection} pc The PeerConnection to the peer
   * @param {rtc.SignalingPeer} signaling_peer The signaling connection to the peer
   */
  createPeer(pc: PeerConnection, signaling_peer: SP): RemotePeer {
    return new RemotePeer(pc, signaling_peer, this.local, this.options);
  }

  private setState(state: RoomState): void {
    this.state = state;
    this.emit("state_changed", state);
  }
};

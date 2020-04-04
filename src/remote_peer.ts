import { Peer } from './peer';

import { StreamCollection } from './internal/stream_collection';
import { ChannelCollection } from './internal/channel_collection';
import { SignalingPeer } from './signaling/signaling';
import { PeerConnection, PeerConnectionFingerprints } from './peer_connection'
import { LocalPeer } from './local_peer'
import { Stream } from './stream'
import { DataChannel } from './data_channel'


/**
 * @module rtc
 */
/**
 * Represents a remote user of the room
 * @class rtc.RemotePeer
 * @extends rtc.Peer
 *
 * @constructor
 * @param {rtc.PeerConnection} peer_connection The underlying peer connection
 * @param {rtc.SignalingPeer} signaling The signaling connection to the peer
 * @param {rtc.LocalPeer} local The local peer
 * @param {Object} options The options object as passed to `Room`
 */
export class RemotePeer extends Peer {

  peer_connection: PeerConnection;
  signaling: SignalingPeer;
  local: LocalPeer;
  options: Record<string,any>;
  private_streams: Record<string,Promise<Stream>>;
  private_channels: Record<string,RTCDataChannelInit>;
  stream_collection: StreamCollection;
  streams: Record<string,Promise<Stream>>;
  // TODO
  streams_desc: Record<string,any>;
  channel_collection: ChannelCollection;
  channels: Record<string,Promise<DataChannel>>
  channels_desc: Record<string,any>;
  connect_p?: Promise<unknown>;

  /**
   * Message received from peer through signaling
   * @event message
   * @param data The payload of the message
   */

  /**
   * The remote peer left or signaling closed
   * @event left
   */

  /**
   * A new stream is available from the peer
   * @event stream_added
   * @param {String} name Name of the stream
   * @param {Promise -> rtc.Stream} stream Promise of the stream
   */

  /**
   * A new data channel is available from the peer
   * @event data_channel_added
   * @param {String} name Name of the channel
   * @param {Promise -> rtc.DataChannel} channel Promise of the channel
   */

  /**
   * The connection to the peer supplied by the signaling implementation
   * @property signaling
   * @type rtc.signaling.SignalingPeer
   */

  constructor(peer_connection: PeerConnection, signaling: SignalingPeer, local: LocalPeer, options: Record<string,any>) {
      super();

    // create streams

    this.peer_connection = peer_connection;
    this.signaling = signaling;
    this.local = local;
    this.options = options;
    this.private_streams = {};
    this.private_channels = {};

    this.stream_collection = new StreamCollection();
    this.streams = this.stream_collection.streams;
    this.streams_desc = {};

    this.stream_collection.on('stream_added', (name, stream) => {
      this.emit('stream_added', name, stream);
    });

    // channels stuff

    this.channel_collection = new ChannelCollection();
    this.channels = this.channel_collection.channels;
    this.channels_desc = {};

    this.channel_collection.on('data_channel_added', (name, channel) => {
      this.emit('data_channel_added', name, channel);
    });

    // resolve streams and data channels

    this.peer_connection.on('stream_added', stream => {
      this.stream_collection.resolve(stream);
    });

    this.peer_connection.on('data_channel_ready', channel => {
      this.channel_collection.resolve(channel);
    });

    // wire up peer connection signaling

    this.peer_connection.on('signaling', data => {
      data.streams = this.streams_desc;
      data.channels = this.channels_desc;
      this.signaling.send('signaling', data);
    });

    this.signaling.on('signaling', data => {
      this.stream_collection.update(data.streams);
      this.channel_collection.setRemote(data.channels);
      this.peer_connection.signaling(data);
    });

    this.peer_connection.on('ice_candidate', candidate => {
      this.signaling.send('ice_candidate', candidate);
    });

    this.signaling.on('ice_candidate', candidate => {
      this.peer_connection.addIceCandidate(candidate);
    });

    // status handling
 
    this.signaling.on('status_changed', status => {
      this.emit('status_changed', status);
    });

    // communication

    this.signaling.on('message', data => {
      this.emit('message', data);
    });

    this.signaling.on('left', () => {
      this.peer_connection.close();
      this.emit('left');
    });

    // pass on signals

    this.peer_connection.on('connected', () => {});

    this.peer_connection.on('closed', () => {});
      // TODO

    // we probably want to connect now

    if (this.options.auto_connect == null || this.options.auto_connect) {
      this.connect();
    }
  }


  // documented in Peer
  status(key: string): any {
    return this.signaling.status[key];
  }


  /**
   * Send a message to the peer through signaling
   * @method message
   * @param data The payload
   * @return {Promise} Promise which is resolved when the data was sent
   */
  message(data: any): void {
    this.signaling.send('message', data);
  }


  /**
   * Connect to the remote peer to exchange streams and create data channels
   * @method connect
   * @return {Promise} Promise which will resolved when the connection is established
   */
  connect(): Promise<unknown> {
    if (this.connect_p == null) {
      // wait for streams

      const stream_promises = Array<Promise<[string,Stream]>>();

      const object = Object.assign({}, this.local.streams, this.private_streams);
      for (const [name, stream] of Object.entries(object)) {
        const promise = stream.then((stream): [string,Stream] => [name, stream]);

        stream_promises.push(promise);
      }

      // TODO: really fail on failed streams?
      this.connect_p = Promise.all(stream_promises).then(streams => {
        // add all streams

        for (const [name, stream] of streams) {
          this.peer_connection.addStream(stream);
          this.streams_desc[name] = stream.id();
        }

        // create data channels

        for (const [name, options] of Object.entries({...this.local.channels, ...this.private_channels})) {
          this.peer_connection.addDataChannel(name, options);
          this.channels_desc[name] = options;
        }

        this.channel_collection.setLocal(this.channels_desc);

        // actually connect

        return this.peer_connection.connect();
      });
    }

    return this.connect_p;
  }


  /**
   * Closes the connection to the peer
   * @method close
   */
  close(): void {
    this.peer_connection.close();
  }


  /**
   * Get a stream from the peer. Has to be sent by the remote peer to succeed.
   * @method stream
   * @param {String} [name='stream'] Name of the stream
   * @return {Promise -> rtc.Stream} Promise of the stream
   */
  stream(name: string): Promise<Stream> {
    if (name == null) { name = Peer.DEFAULT_STREAM; }
    return this.stream_collection.get(name);
  }


  /**
   * Add local stream to be sent to this remote peer
   *
   * If you use this method you have to set `auto_connect` to `false` in the options object and call `connect()` manually on all remote peers.
   *
   * @method addStream
   * @param {String} [name='stream'] Name of the stream
   * @param {Promise -> rtc.Stream | rtc.Stream | Object} stream The stream, a promise to the stream or the configuration to create a stream with `rtc.Stream.createStream()`
   * @return {Promise -> rtc.Stream} Promise of the stream which was added
   */
  addStream(name: string, obj: Stream | Promise<Stream> | MediaStreamConstraints): Promise<Stream> {
    if (!(this.options.auto_connect === false)) {
      return Promise.reject("Unable to add streams directly to remote peers without 'auto_connect' option set to 'false'");
    }

    // helper to actually save stream
    const saveStream = (stream_p: Promise<Stream>) => {
      // TODO: collision detection?
      this.private_streams[name] = stream_p;
      return stream_p;
    };

    // name can be omitted ... once
    if (typeof name !== 'string') {
      obj = name;
      name = Peer.DEFAULT_STREAM;
    }

    if ('then' in obj) {
      // it is a promise
      return saveStream(obj);
    } else if (obj instanceof Stream) {
      // it is the actual stream, turn into promise
      return saveStream(Promise.resolve(obj));
    } else {
      // we assume we can pass it on to create a stream
      const stream_p = Stream.createStream(obj);
      return saveStream(stream_p);
    }
  }


  /**
   * Get a data channel to the remote peer. Has to be added by local and remote side to succeed.
   * @method channel
   * @param {String} [name='data'] Name of the data channel
   * @return {Promise -> rtc.DataChannel} Promise of the data channel
   */
  channel(name: string): Promise<DataChannel> {
    if (name == null) { name = Peer.DEFAULT_CHANNEL; }
    return this.channel_collection.get(name);
  }


  /**
   * Add data channel which will be negotiated with this remote peer
   *
   * If you use this method you have to set `auto_connect` to `false` in the options object and call `connect()` manually on all remote peers.
   *
   * @method addDataChannel
   * @param {String} [name='data'] Name of the data channel
   * @param {Object} [desc={ordered: true}] Options passed to `RTCDataChannel.createDataChannel()`
   */
  addDataChannel(name: string, desc: RTCDataChannelInit): Promise<DataChannel> {
    if (!(this.options.auto_connect === false)) {
      return Promise.reject("Unable to add channels directly to remote peers without 'auto_connect' option set to 'false'");
    }

    if (typeof name !== 'string') {
      desc = name;
      name = Peer.DEFAULT_CHANNEL;
    }

    if (desc == null) {
      // TODO: default handling
      desc = {
        ordered: true
      };
    }

    this.private_channels[name] = desc;

    return this.channel(name);
  }

  // TODO improve jsdoc
  /**
   * Checks whether the peer is the local peer. Returns always `false` on this
   * class.
   * @method currentFingerprints
   * @return {Object} Returns fingerprint used in underlying peer connection
   */
  currentFingerprints(): PeerConnectionFingerprints {
    return this.peer_connection.fingerprints();
  }


  /**
   * Checks whether the peer is the local peer. Returns always `false` on this
   * class.
   * @method isLocal
   * @return {Boolean} Returns `false`
   */
  isLocal(): boolean {
    return false;
  }
};

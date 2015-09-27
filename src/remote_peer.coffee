Promise = require('./compat').compat.Promise
Peer = require('./peer').Peer

StreamCollection = require('./internal/stream_collection').StreamCollection
ChannelCollection = require('./internal/channel_collection').ChannelCollection


class exports.RemotePeer extends Peer

  constructor: (@peer_connection, @signaling, @local, @options) ->
    # create streams

    @stream_collection = new StreamCollection()
    @streams = @stream_collection.streams
    @streams_desc = {}

    # channels stuff

    @channel_collection = new ChannelCollection()
    @channels = @channel_collection.channels
    @channels_desc = {}

    # resolve streams and data channels

    @peer_connection.on 'stream_added', (stream) =>
      @stream_collection.resolve(stream)

    @peer_connection.on 'data_channel_ready', (channel) =>
      @channel_collection.resolve(channel)

    # wire up peer connection signaling

    @peer_connection.on 'signaling', (data) =>
      data.streams = @streams_desc
      data.channels = @channels_desc
      @signaling.send('signaling', data)

    @signaling.on 'signaling', (data) =>
      @stream_collection.update(data.streams)
      @channel_collection.setRemote(data.channels)
      @peer_connection.signaling(data)

    @peer_connection.on 'ice_candidate', (candidate) =>
      @signaling.send('ice_candidate', candidate)

    @signaling.on 'ice_candidate', (candidate) =>
      @peer_connection.addIceCandidate(candidate)

    # communication

    @signaling.on 'message', (data) =>
      @emit 'message', data

    @signaling.on 'closed', () =>
      @peer_connection.close()
      @emit('closed')

    # pass on signals

    @peer_connection.on 'connected', () =>

    @peer_connection.on 'closed', () =>
      # TODO

    # we probably want to connect now

    if not @options.auto_connect? or not @options.auto_connect
      @connect()


  status: (key) ->
    # TODO
    if key?
      return @status_obj[key]
    else
      return @status_obj


  message: (data) ->
    return @signaling.send('message', data)


  connect: () ->
    if not @connect_p?
      # wait for streams

      stream_promises = []

      for name, stream of @local.streams
        promise = stream.then (stream) ->
          return [name, stream]

        stream_promises.push(promise)

      # TODO: really fail on failed streams?
      @connect_p = Promise.all(stream_promises).then (streams) =>
        # add all streams

        for [name, stream] in streams
          @peer_connection.addStream(stream)
          @streams_desc[name] = stream.id()

        # create data channels

        for name, options of @local.channels
          @peer_connection.addDataChannel(name, options)
          @channels_desc[name] = options

        @channel_collection.setLocal(@channels_desc)

        # actually connect

        return @peer_connection.connect()

    return @connect_p


  close: () ->
    return @peer_connection.close()


  stream: (name=@DEFAULT_STREAM) ->
    @stream_collection.get(name)


  channel: (name=@DEFAULT_CHANNEL) ->
    @channel_collection.get(name)

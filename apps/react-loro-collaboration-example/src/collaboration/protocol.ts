import { Schema } from 'effect'

export const RoomStateMessage = Schema.Struct({
  _tag: Schema.Literals(['RoomState']),
  roomId: Schema.String,
  peers: Schema.Number,
})

export type RoomStateMessage = typeof RoomStateMessage.Type

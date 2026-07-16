import { Schema } from 'effect'
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi'

import { SaveTodoDocument, TodoDocument } from './todo'

export class TodoConflict extends Schema.ErrorClass<TodoConflict>(
  'TodoConflict'
)(
  {
    _tag: Schema.tag('TodoConflict'),
    expectedVersion: Schema.Int,
    actualVersion: Schema.Int,
    current: TodoDocument,
  },
  { httpApiStatus: 409 }
) {}

class TodoDocumentsApi extends HttpApiGroup.make('todoDocuments')
  .add(
    HttpApiEndpoint.get('get', '/:id', {
      params: { id: Schema.String },
      success: TodoDocument,
    }),
    HttpApiEndpoint.put('save', '/:id', {
      params: { id: Schema.String },
      payload: SaveTodoDocument,
      success: TodoDocument,
      error: TodoConflict,
    })
  )
  .prefix('/api/todo-documents') {}

class SystemApi extends HttpApiGroup.make('system', { topLevel: true }).add(
  HttpApiEndpoint.get('health', '/health', {
    success: Schema.Struct({ status: Schema.Literal('ok') }),
  })
) {}

export class TodoApi extends HttpApi.make('todo-api')
  .add(TodoDocumentsApi)
  .add(SystemApi) {}

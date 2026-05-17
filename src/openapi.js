'use strict';

const config = require('./config');

function buildOpenApiSpec() {
  return {
    openapi: '3.0.3',
    info: {
      title: 'Notes App API',
      version: '1.0.0',
      description:
        'A multi-user notes service with JWT-based authentication, note sharing, tags, pinning, archiving, version history, full-text search, and pagination.',
      contact: { name: config.about.name, email: config.about.email },
      license: { name: 'MIT' },
    },
    servers: [
      { url: '/', description: 'Current server' },
    ],
    tags: [
      { name: 'Auth', description: 'User registration & login' },
      { name: 'Notes', description: 'Create, read, update, delete, share notes' },
      { name: 'Search', description: 'Full-text search across accessible notes' },
      { name: 'Meta', description: 'About & OpenAPI metadata endpoints' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            message: { type: 'string' },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  path: { type: 'string' },
                  message: { type: 'string' },
                  code: { type: 'string' },
                },
              },
            },
          },
        },
        Credentials: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', format: 'email', example: 'alice@example.com' },
            password: { type: 'string', minLength: 8, example: 'StrongP@ssw0rd' },
          },
        },
        RegisterResponse: {
          type: 'object',
          properties: {
            message: { type: 'string' },
            user: {
              type: 'object',
              properties: {
                id: { type: 'string', format: 'uuid' },
                email: { type: 'string', format: 'email' },
                created_at: { type: 'string', format: 'date-time' },
              },
            },
          },
        },
        LoginResponse: {
          type: 'object',
          properties: {
            access_token: { type: 'string' },
            token_type: { type: 'string', example: 'Bearer' },
          },
        },
        Note: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            owner_id: { type: 'string', format: 'uuid' },
            title: { type: 'string' },
            content: { type: 'string' },
            pinned: { type: 'boolean' },
            archived: { type: 'boolean' },
            tags: { type: 'array', items: { type: 'string' } },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
          },
        },
        NoteCreate: {
          type: 'object',
          required: ['title'],
          properties: {
            title: { type: 'string', minLength: 1, maxLength: 200 },
            content: { type: 'string', maxLength: 100000 },
            tags: { type: 'array', items: { type: 'string', maxLength: 32 }, maxItems: 20 },
            pinned: { type: 'boolean' },
          },
        },
        NoteUpdate: {
          type: 'object',
          properties: {
            title: { type: 'string', minLength: 1, maxLength: 200 },
            content: { type: 'string', maxLength: 100000 },
            tags: { type: 'array', items: { type: 'string', maxLength: 32 }, maxItems: 20 },
            pinned: { type: 'boolean' },
            archived: { type: 'boolean' },
          },
        },
        NotesPage: {
          type: 'object',
          properties: {
            items: { type: 'array', items: { $ref: '#/components/schemas/Note' } },
            pagination: {
              type: 'object',
              properties: {
                page: { type: 'integer' },
                limit: { type: 'integer' },
                total: { type: 'integer' },
                total_pages: { type: 'integer' },
                has_next: { type: 'boolean' },
                has_prev: { type: 'boolean' },
              },
            },
          },
        },
        ShareRequest: {
          type: 'object',
          required: ['share_with_email'],
          properties: {
            share_with_email: { type: 'string', format: 'email' },
            permission: { type: 'string', enum: ['read', 'write'], default: 'read' },
          },
        },
        AboutResponse: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            email: { type: 'string', format: 'email' },
            'my features': {
              type: 'object',
              additionalProperties: { type: 'string' },
            },
          },
        },
      },
      responses: {
        Unauthorized: {
          description: 'Missing or invalid token',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        Forbidden: {
          description: 'Authenticated but not allowed',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        NotFound: {
          description: 'Resource not found',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        ValidationError: {
          description: 'Request validation failed',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
      },
    },
    paths: {
      '/register': {
        post: {
          tags: ['Auth'],
          summary: 'Register a new user',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Credentials' } } },
          },
          responses: {
            201: {
              description: 'User created',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/RegisterResponse' } },
              },
            },
            400: { $ref: '#/components/responses/ValidationError' },
            409: {
              description: 'Email already in use',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
            },
          },
        },
      },
      '/login': {
        post: {
          tags: ['Auth'],
          summary: 'Authenticate and receive a JWT',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Credentials' } } },
          },
          responses: {
            200: {
              description: 'JWT issued',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/LoginResponse' } },
              },
            },
            401: {
              description: 'Invalid credentials',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Error' },
                  example: { message: 'Invalid email or password' },
                },
              },
            },
            400: { $ref: '#/components/responses/ValidationError' },
          },
        },
      },
      '/notes': {
        get: {
          tags: ['Notes'],
          summary: 'List notes accessible to the authenticated user',
          security: [{ bearerAuth: [] }],
          parameters: [
            { in: 'query', name: 'page', schema: { type: 'integer', minimum: 1, default: 1 } },
            {
              in: 'query',
              name: 'limit',
              schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
            },
            {
              in: 'query',
              name: 'archived',
              schema: { type: 'string', enum: ['true', 'false', 'all'], default: 'false' },
            },
            { in: 'query', name: 'tag', schema: { type: 'string' } },
            {
              in: 'query',
              name: 'shared',
              schema: { type: 'string', enum: ['owned', 'shared', 'all'], default: 'all' },
            },
            {
              in: 'query',
              name: 'sort',
              schema: {
                type: 'string',
                enum: ['created_at', 'updated_at', 'title'],
                default: 'updated_at',
              },
            },
            {
              in: 'query',
              name: 'order',
              schema: { type: 'string', enum: ['asc', 'desc'], default: 'desc' },
            },
          ],
          responses: {
            200: {
              description: 'Page of notes',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/NotesPage' } },
              },
            },
            401: { $ref: '#/components/responses/Unauthorized' },
          },
        },
        post: {
          tags: ['Notes'],
          summary: 'Create a new note',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/NoteCreate' } } },
          },
          responses: {
            201: {
              description: 'Note created',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Note' } } },
            },
            400: { $ref: '#/components/responses/ValidationError' },
            401: { $ref: '#/components/responses/Unauthorized' },
          },
        },
      },
      '/notes/{id}': {
        parameters: [
          { in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        get: {
          tags: ['Notes'],
          summary: 'Get a single note by ID',
          security: [{ bearerAuth: [] }],
          responses: {
            200: {
              description: 'Note data',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Note' } } },
            },
            401: { $ref: '#/components/responses/Unauthorized' },
            403: { $ref: '#/components/responses/Forbidden' },
            404: { $ref: '#/components/responses/NotFound' },
          },
        },
        put: {
          tags: ['Notes'],
          summary: 'Update a note (owner or write-permission collaborator)',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/NoteUpdate' } } },
          },
          responses: {
            200: {
              description: 'Updated note',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Note' } } },
            },
            400: { $ref: '#/components/responses/ValidationError' },
            401: { $ref: '#/components/responses/Unauthorized' },
            403: { $ref: '#/components/responses/Forbidden' },
            404: { $ref: '#/components/responses/NotFound' },
          },
        },
        delete: {
          tags: ['Notes'],
          summary: 'Delete a note (owner only)',
          security: [{ bearerAuth: [] }],
          responses: {
            204: { description: 'Deleted' },
            401: { $ref: '#/components/responses/Unauthorized' },
            403: { $ref: '#/components/responses/Forbidden' },
            404: { $ref: '#/components/responses/NotFound' },
          },
        },
      },
      '/notes/{id}/share': {
        parameters: [
          { in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        post: {
          tags: ['Notes'],
          summary: 'Share a note with another user',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ShareRequest' } } },
          },
          responses: {
            200: {
              description: 'Shared',
              content: {
                'application/json': {
                  schema: { type: 'object', properties: { message: { type: 'string' } } },
                },
              },
            },
            400: { $ref: '#/components/responses/ValidationError' },
            401: { $ref: '#/components/responses/Unauthorized' },
            403: { $ref: '#/components/responses/Forbidden' },
            404: { $ref: '#/components/responses/NotFound' },
            409: {
              description: 'Already shared with that user',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
            },
          },
        },
        delete: {
          tags: ['Notes'],
          summary: "Revoke a user's access to a note",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['revoke_email'],
                  properties: { revoke_email: { type: 'string', format: 'email' } },
                },
              },
            },
          },
          responses: {
            200: { description: 'Revoked' },
            401: { $ref: '#/components/responses/Unauthorized' },
            403: { $ref: '#/components/responses/Forbidden' },
            404: { $ref: '#/components/responses/NotFound' },
          },
        },
      },
      '/notes/{id}/shares': {
        parameters: [
          { in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        get: {
          tags: ['Notes'],
          summary: 'List users this note is shared with (owner only)',
          security: [{ bearerAuth: [] }],
          responses: {
            200: { description: 'Shares list' },
            401: { $ref: '#/components/responses/Unauthorized' },
            403: { $ref: '#/components/responses/Forbidden' },
            404: { $ref: '#/components/responses/NotFound' },
          },
        },
      },
      '/notes/{id}/versions': {
        parameters: [
          { in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        get: {
          tags: ['Notes'],
          summary: 'List historical versions of a note',
          security: [{ bearerAuth: [] }],
          responses: {
            200: { description: 'Versions list (most recent first)' },
            401: { $ref: '#/components/responses/Unauthorized' },
            403: { $ref: '#/components/responses/Forbidden' },
            404: { $ref: '#/components/responses/NotFound' },
          },
        },
      },
      '/search': {
        get: {
          tags: ['Search'],
          summary: 'Full-text search over notes accessible to the user',
          security: [{ bearerAuth: [] }],
          parameters: [
            { in: 'query', name: 'q', required: true, schema: { type: 'string', minLength: 1 } },
            { in: 'query', name: 'page', schema: { type: 'integer', minimum: 1, default: 1 } },
            {
              in: 'query',
              name: 'limit',
              schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
            },
          ],
          responses: {
            200: { description: 'Search results' },
            400: { $ref: '#/components/responses/ValidationError' },
            401: { $ref: '#/components/responses/Unauthorized' },
          },
        },
      },
      '/about': {
        get: {
          tags: ['Meta'],
          summary: 'About the author and custom features',
          responses: {
            200: {
              description: 'About object',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/AboutResponse' } },
              },
            },
          },
        },
      },
      '/openapi.json': {
        get: {
          tags: ['Meta'],
          summary: 'OpenAPI 3.0 specification for this API',
          responses: { 200: { description: 'The OpenAPI JSON document' } },
        },
      },
      '/healthz': {
        get: {
          tags: ['Meta'],
          summary: 'Liveness probe',
          responses: { 200: { description: 'OK' } },
        },
      },
    },
  };
}

module.exports = { buildOpenApiSpec };

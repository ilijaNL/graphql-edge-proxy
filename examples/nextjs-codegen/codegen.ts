import { CodegenConfig } from '@graphql-codegen/cli';

const sharedConfig = {
  enumsAsConst: true,
  skipTypename: true,
  avoidOptionals: {
    field: true,
    inputValue: false,
    object: true,
    defaultValue: false,
  },
  // avoidOptionals: true,
  scalars: {
    uuid: 'string',
    UUID: 'string',
    EmailAddress: 'string',
    JSONObject: 'Record<string, any>',
    bigint: 'number',
    timestamptz: 'string',
    timestampt: 'string',
    time: 'string',
    Date: 'Date',
    json: 'Record<string, any> | Array<any>',
    jsonb: 'Record<string, any> | Array<any>',
  },
};

const config: CodegenConfig = {
  schema: ['https://countries.trevorblades.com/'],
  documents: ['src/**/*.graphql'],
  generates: {
    './src/__generated__/gql.ts': {
      plugins: ['typescript', 'typescript-operations', 'typed-document-node'],
      config: {
        ...sharedConfig,
      },
    },
    './src/__generated__/operations.json': {
      plugins: ['graphql-operation-list'],
    },
  },
};

export default config;

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
      plugins: ['typescript', 'typescript-operations'],
      config: {
        ...sharedConfig,
      },
    },
    './src/__generated__/signed-operations.json': {
      plugins: ['graphql-codegen-signed-operation'],
      config: {
        // should be long and not exposed to public
        secret: 'some-secret',
      },
    },
  },
};

export default config;

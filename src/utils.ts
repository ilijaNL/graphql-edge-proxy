import { DocumentNode, parse as _parse, introspectionTypes, visit as _visit } from 'graphql';
import { printExecutableGraphQLDocument } from '@graphql-tools/documents';

const documentMap = new Map<string, DocumentNode>();

export function parse(input: string, maxTokens = 5000) {
  if (documentMap.has(input)) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return documentMap.get(input)!;
  }

  const parsed = _parse(input, { maxTokens: maxTokens });
  documentMap.set(input, parsed);

  return parsed;
}

const normalizedMap = new WeakMap<DocumentNode, string>();

export function printNormalized(doc: DocumentNode) {
  if (normalizedMap.has(doc)) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return normalizedMap.get(doc)!;
  }

  const value = printExecutableGraphQLDocument(doc);
  normalizedMap.set(doc, value);

  return value;
}

/**
 * Checks if document has introspection items
 * @param documentNode
 * @returns
 */
export function documentHasIntrospection(documentNode: DocumentNode) {
  const forbiddenNames = new Set(introspectionTypes.map((t) => t.name.toLowerCase()));
  let isIntrospection = false;
  _visit(documentNode, {
    Field(node) {
      if (forbiddenNames.has(node.name.value)) {
        isIntrospection = true;
      }
    },
  });

  return isIntrospection;
}

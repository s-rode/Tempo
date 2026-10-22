# Shared Types

This directory contains the shared type definitions that are used as a single source of truth for both the client and server.

## Type Organization

The project uses a "single source of truth" approach for type sharing:

1. All common types are defined in `shared/types.ts`
2. Both client and server import types directly from this shared file using the `@shared/types` import path

## Updating Types

When you need to update a type that's used in both client and server:

1. Update the definition in `shared/types.ts`
2. The changes will automatically be available to both client and server code

This approach ensures type consistency across the entire project and eliminates duplication.

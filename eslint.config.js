import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'dist-check/**', 'coverage/**', 'node_modules/**', 'skills/**', 'scripts/probes/**', '.tmp/**', 'build/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // ANK-04: never delete through the AnkiConnect API.
      'no-restricted-syntax': [
        'error',
        { selector: "Literal[value='deleteNotes']", message: 'ANK-04: deleting Anki notes is forbidden.' },
        { selector: "Literal[value='deleteDecks']", message: 'ANK-04: deleting Anki decks is forbidden.' },
      ],
    },
  },
);

module.exports = {
  "parser": "@typescript-eslint/parser",
  "extends": ["plugin:@typescript-eslint/recommended", "prettier"],
  "parserOptions": { "ecmaVersion": 2018, "sourceType": "module" },
  "env": {
    "node": true,
    "es6": true
  },
  "rules": {
    "no-console": 2,
    "@typescript-eslint/no-inferrable-types": 0,
    // should remove this in the end
    "@typescript-eslint/no-explicit-any": 0,
    "@typescript-eslint/ban-types": 0
  }
}
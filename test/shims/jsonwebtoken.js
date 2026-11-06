// Test-only: @nestjs/jwt v12 is an ES module that default-imports this CommonJS
// package. Node handles that at runtime; Jest's CommonJS loader needs `default`.
const jsonwebtoken = require('../../node_modules/jsonwebtoken');

module.exports = { ...jsonwebtoken, default: jsonwebtoken, __esModule: true };

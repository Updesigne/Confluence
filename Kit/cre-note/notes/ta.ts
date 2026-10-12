
import * as ts from "typescript";

console.log("Version:", ts.version);
console.log("ScriptTarget:", typeof ts.ScriptTarget);
console.log("ESNext:", ts.ScriptTarget?.ESNext);

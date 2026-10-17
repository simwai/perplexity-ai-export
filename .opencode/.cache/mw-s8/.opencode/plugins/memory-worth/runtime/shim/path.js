"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shimPath = shimPath;
const node_path_1 = require("node:path");
function shimPath() {
    return { resolve: node_path_1.resolve, join: node_path_1.join, dirname: node_path_1.dirname, basename: node_path_1.basename, isAbsolute: node_path_1.isAbsolute, sep: node_path_1.sep };
}

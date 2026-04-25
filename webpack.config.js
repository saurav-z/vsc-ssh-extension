// @ts-check
const path = require('path');

/** @type {import('webpack').Configuration} */
const config = {
    target: 'node',
    entry: './src/extension.ts',
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: 'extension.js',
        libraryTarget: 'commonjs2'
    },
    externals: {
        // vscode API is provided by the editor at runtime
        vscode: 'commonjs vscode',
        // ssh2's native crypto & cpu-features addons must load at runtime from node_modules,
        // not be bundled — webpack cannot process binary .node files.
        'cpu-features': 'commonjs cpu-features',
        'sshcrypto': 'commonjs sshcrypto'
    },
    resolve: {
        extensions: ['.ts', '.js']
    },
    module: {
        rules: [
            {
                test: /\.ts$/,
                exclude: /node_modules/,
                use: ['ts-loader']
            },
            {
                // Copy native .node addons to dist and load them from there
                test: /\.node$/,
                use: [
                    {
                        loader: 'file-loader',
                        options: {
                            name: 'native/[name].[ext]'
                        }
                    }
                ]
            }
        ]
    },
    devtool: 'nosources-source-map'
};

module.exports = config;

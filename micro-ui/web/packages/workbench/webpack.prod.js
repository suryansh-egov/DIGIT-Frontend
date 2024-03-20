require('dotenv').config();

const { merge } = require("webpack-merge");
const ModuleFederationPlugin = require("webpack/lib/container/ModuleFederationPlugin");
const commonConfig = require("./webpack.common");
const packageJson = require("./package.json");
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const CssMinimizerPlugin = require('css-minimizer-webpack-plugin');
const ExternalRemotesPlugin = require('external-remotes-plugin');

module.exports = () => {
  const prodConfig = {
    mode: "production",
    output: {
      publicPath: "/workbench-mfe/",
      filename: "[name].[contenthash].js",
    },
    plugins: [
      new ExternalRemotesPlugin(),
      new ModuleFederationPlugin({
        name: "workbench",
        filename: "remoteEntry.js",
        exposes: {
          "./WorkbenchModule": "./src/SingleSpaEntry",
        },
        shared: {
          "single-spa-react": "^4.6.1",
          "xlsx": "0.17.5",
          "@rjsf/core": "5.10.0",
          "@rjsf/utils": "5.10.0",
          "@rjsf/validator-ajv8": "5.10.0",
          "react": "17.0.2",
          "react-date-range": "1.4.0",
          "react-dom": "17.0.2",
          "react-hook-form": "6.15.8",
          "react-i18next": "11.16.2",
          "react-query": "3.6.1",
          "react-router-dom": "5.3.0",
          "react-select": "5.7.4",
          "webpack": "^5.68.0",
          "webpack-cli": "^4.9.2",
          "webpack-dev-server": "^4.8.1",
          "webpack-merge": "5.7.3",
          "@heroicons/react": "^1.0.1",
          "@mkeeorg/federation-ui": "^1.3.0",
          "classnames": "^2.3.2"
        }
      }),
      new MiniCssExtractPlugin(
        false
          ? {
              filename: 'static/css/[name].[contenthash].css',
              chunkFilename: 'static/css/[name].[contenthash].css',
            }
          : {}
      ),
    ].filter(Boolean),
    optimization: {
      minimize: true, //true if prod
      minimizer: ['...', new CssMinimizerPlugin()],
    },
  };

  return merge(commonConfig, prodConfig);
};

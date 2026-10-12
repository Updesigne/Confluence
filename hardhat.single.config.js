// hardhat.single.config.js
require("@nomicfoundation/hardhat-toolbox");

const TARGET = process.env.TARGET_CONTRACT || "./contracts/coordination/Confluence.sol";

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: false,
      evmVersion: "paris",
    },
  },
  paths: {
    sources: "./contracts_isolated",
    tests: "./test",
    cache: "./cache_isolated",
    artifacts: "./artifacts_isolated",
  },
};
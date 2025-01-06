# Satsurance Project Smart-contracts

This project demonstrates a basic Satsurance logic and use cases. It is focus on testing the math of the protol.

To run tests:

```shell
npx hardhat test
```

# Run local node and setup for UI tests
1. First run hardhat evm local node with the command:
```shell
npx hardhat node --hostname 0.0.0.0
```
2. In the `ignition/modules/LocalDeploy.js` you should change `BIG_STAKER_ADDR` and `POOL_OWNER_ADDR` to your metamask accounts.

3. Then make initial contracts setup with:
```shell
npx hardhat ignition deploy ignition/modules/Insurance.js --network localhost && npx hardhat ignition deploy ignition/modules/LocalDeploy.js --network localhost
```
**You may need to uncomment `module.exports = exports.InsuranceSetup;` in `igntion/modules/Insurance.js`

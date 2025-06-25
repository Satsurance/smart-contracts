const ALLOWED_UNDERSTAKING = ethers.parseUnits("0.000000001", "ether"); // 0.01 cent if bitcoin costs 100k
const SECS_IN_DAY = 60 * 60 * 24;
const MINIMUM_STAKE_AMOUNT_BTC = ethers.parseUnits("0.00001", "ether"); // 0.00000001 BTC
// Episode duration matches the contract: 91 days / 3 = ~30.33 days
const EPISODE_DURATION = Math.floor((91 * 24 * 60 * 60) / 3); // 91 days / 3 in seconds

module.exports = {
    ALLOWED_UNDERSTAKING,
    SECS_IN_DAY,
    EPISODE_DURATION,
    MINIMUM_STAKE_AMOUNT_BTC,
}; 
/**
 * Renvoie la version depuis package.json.
 */
module.exports = () => {
    return require('./package.json').version;
};

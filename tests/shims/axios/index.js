const stub = {
  post: async function () {
    throw new Error("axios shim should not be called during Arktan compare runs");
  },
};

module.exports = stub;
module.exports.default = stub;

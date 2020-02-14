const { getKeysFromSeed } = require('./utils');
const debug = require('debug')('service');

// No liveness data from leader count
let noLivenessFromLeader = 0;
const noLivenessThreshold = 5;

// Orchestrate service
const orchestrateService = async (chain, metrics, mnemonic, aliveTime, service) => {
  try {
    console.log('Orchestrating service.....');

    // If node state permits to send transactions
    const sendTransaction = await chain.canSendTransactions();

    if (sendTransaction) {
      console.log('Archipel node has some peers and is synchronized so orchestrating...');
      // Get node address from seed
      const key = await getKeysFromSeed(mnemonic);
      const nodeKey = key.address;
      debug('orchestrateService', `Current Node Key: ${nodeKey}`);

      // Get current leader from chain
      let currentLeader = await chain.getLeader();
      currentLeader = currentLeader.toString();

      // If current leader is already set
      if (currentLeader !== '') {
        debug('orchestrateService', `Current Leader: ${currentLeader}`);
        // If you are the current leader
        if (currentLeader === nodeKey) {
          console.log('Current node is leader.');
          await serviceStartIfAnyoneActive(nodeKey, aliveTime, metrics, service);
        // If someone else is leader
        } else {
          await otherLeaderAction(metrics, currentLeader, aliveTime, chain, mnemonic, service, nodeKey);
        }
      // Leader is not already set (first time boot)
      } else {
        console.log('There is no leader set...');
        await becomeLeader(nodeKey, nodeKey, chain, mnemonic, service, metrics, aliveTime);
      }
    } else {
      console.log('Archipel node can\'t receive transactions...');
    }
  } catch (error) {
    debug('orchestrateService', error);
    console.error(error);
  }
};

// Act if other node is leader
const otherLeaderAction = async (metrics, currentLeader, aliveTime, chain, mnemonic, service, nodeKey) => {
  try {
    // Get leader metrics known
    const leaderMetrics = metrics.getMetrics(currentLeader);

    // If leader already sent an Metrics Update
    if (leaderMetrics !== undefined) {
      const nowTime = new Date().getTime();
      const lastSeenAgo = nowTime - leaderMetrics.timestamp;

      // Checking if leader can be considered alive
      if (lastSeenAgo > aliveTime) {
        await becomeLeader(currentLeader, nodeKey, chain, mnemonic, service, metrics, aliveTime);
      } else {
        console.log(`Leader ${currentLeader} is alive no action required...`);
        console.log('Enforcing passive mode...');
        await serviceStart(service, 'passive');
      }

    // If there is no metrics received from leader node
    } else {
      // How much checks remains
      const checksNumber = noLivenessThreshold - noLivenessFromLeader;

      if (checksNumber > 0) {
        console.log('No liveness data from received from leader node...');
        console.log(`Will try to get leader place in ${checksNumber} checks...`);
        // Incrementing noLivenessFromLeader counter
        noLivenessFromLeader++;

      // No metrics received for noLivenessThreshold times. Leader is offline.
      } else {
        console.log(`Can't check leader liveness for ${noLivenessThreshold} times.`);
        await becomeLeader(currentLeader, nodeKey, chain, mnemonic, service, metrics, aliveTime);
      }
    }
  } catch (error) {
    debug('otherLeaderAction', error);
    throw error;
  }
};

// Set leader on chain and launch service
const becomeLeader = async (oldLeaderKey, nodeKey, chain, mnemonic, service, metrics, aliveTime) => {
  try {
    console.log('Trying to become leader...');
    const leaderSet = await chain.setLeader(oldLeaderKey, mnemonic);

    if (leaderSet === true) {
      console.log('The leader set transaction was completed...');
      console.log('Sleeping 10 seconds to be sure that transaction was propagated to every node...');
      await new Promise(resolve => setTimeout(resolve, 10000));
      await serviceStartIfAnyoneActive(nodeKey, aliveTime, metrics, service);
    } else {
      console.log('Can\'t set leader.');
      console.log('Transaction failed or someone already took the leader place...');
    }
  } catch (error) {
    debug('becomeLeader', error);
    throw error;
  }
};

// Start active service is there is anyone online
const serviceStartIfAnyoneActive = async (nodeKey, aliveTime, metrics, service) => {
  try {
    // The node is not isolated launching service in active mode
    if (metrics.anyOneAlive(nodeKey, aliveTime)) {
      console.log('Found someone online...');
      console.log('Launching active node...');
      await serviceStart(service, 'active');
    // The node is isolated launching service in passive mode
    } else {
      console.log('Seems that no one is online...');
      console.log('Launching passive node...');
      await serviceStart(service, 'passive');
    }
  } catch (error) {
    debug('currentLeader', error);
    throw error;
  }
};

// Start a service
const serviceStart = async (service, mode) => {
  try {
    await service.start(mode);
  } catch (error) {
    debug('serviceStart', error);
    throw error;
  }
};

// Cleanup a service
const serviceCleanUp = async service => {
  try {
    await service.cleanUp();
  } catch (error) {
    debug('serviceCleanUp', error);
    console.error(error);
  }
};

module.exports = {
  orchestrateService,
  serviceStart,
  serviceCleanUp
};

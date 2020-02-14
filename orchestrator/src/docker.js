const Dockerode = require('dockerode');

const { streamToString } = require('./utils');

const debug = require('debug')('docker');

class Docker {
  constructor () {
    try {
      this.docker = new Dockerode({ socketPath: '/var/run/docker.sock' });
    } catch (error) {
      debug('constructor', error);
      throw error;
    }
  }

  // Pull docker image progress
  onProgress (event) {
    if (event.progress) console.log(event.progress);
  }

  // Pull docker image
  async dockerPull (image) {
    return new Promise((resolve, reject) => {
      // Pulling docker image
      this.docker.pull(image, (error, stream) => {
        console.log(`Pulling ${image} image...`);
        if (error) reject(error);
        // Following pull progress
        this.docker.modem.followProgress(stream, error => {
          if (error) reject(error);
          console.log('Image was successfully pulled.');
          resolve(true);
        }, this.onProgress);
      });
    });
  }

  // Execute a command in a docker container
  async dockerExecute (name, command) {
    try {
      // Get container instance
      const container = this.docker.getContainer(name);

      // Exec a command and get a stream
      const exec = await container.exec({ Cmd: command, AttachStdin: true, AttachStdout: true });
      const stream = await exec.start();

      // Convert stream to a string to return it
      return await streamToString(stream);
    } catch (error) {
      debug('getContainerByName', error);
      console.error(error);
      return false;
    }
  }

  // Get container instance by name
  async getContainerByName (name) {
    try {
      const containers = await this.docker.listContainers({ all: true });
      return containers.find(element => {
        return element.Names[0] === '/' + name ? element : false;
      });
    } catch (error) {
      debug('getContainerByName', error);
      throw error;
    }
  }

  // Get volume instance by name
  async getVolumeByName (name) {
    try {
      const volumes = await this.docker.listVolumes();
      return volumes.Volumes.find(element => {
        return element.Name === name ? element : false;
      });
    } catch (error) {
      debug('getVolumeByName', error);
      throw error;
    }
  }

  // Pulling image, creating and starting a container
  async startContainer (containerData) {
    try {
      // Pulling image
      await this.dockerPull(containerData.Image);

      // Starting container
      console.log('Creating and starting container...');
      const container = await this.docker.createContainer(containerData);
      await container.start();

      return true;
    } catch (error) {
      debug('startContainer', error);
      throw error;
    }
  };

  // Creating a volume
  async createVolume (name) {
    try {
      const volume = await this.getVolumeByName(name);
      if (volume === undefined) {
        const options = {
          Name: name
        };
        await this.docker.createVolume(options);
        return true;
      } else {
        debug('createVolume', 'Volume already exists.');
        return false;
      }
    } catch (error) {
      debug('createVolume', error);
      throw error;
    }
  }

  // Remove 'down' container and start 'up' container
  async prepareAndStart (containerData, upName, downName, containerUp, containerDown) {
    try {
      // Setting container name
      containerData.name = upName;

      // We must stop down container if necessary
      if (containerDown !== undefined) {
        console.log(`Stopping ${downName} container...`);
        await this.removeContainer(downName);
      }

      if (containerUp === undefined) {
        // Starting container
        console.log(`Starting ${upName} container...`);
        await this.startContainer(containerData);
        return true;
      } else {
        // If container exits but is not in running state
        // We will stop and restart it
        if (containerUp.State !== 'running') {
          console.log(`Restarting container ${containerData.name}...`);
          await this.removeContainer(containerData.name);
          await this.startContainer(containerData);
        }

        console.log('Service is already started.');
        return false;
      }
    } catch (error) {
      debug('prepareAndStart', error);
      throw error;
    }
  };

  // Start passive or active service container
  async startServiceContainer (type, activeName, passiveName, image, cmd, mountTarget, mountSource) {
    try {
      // Creating volume
      await this.createVolume(mountSource);

      // Constructing container data
      const containerData = {
        name: '',
        Image: image,
        Cmd: cmd,
        HostConfig: {
          Mounts: [
            {
              Target: mountTarget,
              Source: mountSource,
              Type: 'volume',
              ReadOnly: false
            }
          ]
        }
      };

      // Get passive and active containers
      const containerPassive = await this.getContainerByName(passiveName);
      const containerActive = await this.getContainerByName(activeName);

      // If we want to start active container
      if (type === 'active') {
        return await this.prepareAndStart(containerData, activeName, passiveName, containerActive, containerPassive);
      // We want to start passive container
      } else {
        return await this.prepareAndStart(containerData, passiveName, activeName, containerPassive, containerActive);
      }
    } catch (error) {
      debug('startServiceContainer', error);
      throw error;
    }
  }

  // Stop and remove container
  async removeContainer (name) {
    try {
      const containerByName = await this.getContainerByName(name);
      console.log(`Deleting container ${name}...`);
      if (containerByName !== undefined) {
        const container = await this.docker.getContainer(containerByName.Id);
        await container.remove({ force: true });
        return true;
      } else {
        console.log(`Container ${name} was not found.`);
        return false;
      }
    } catch (error) {
      debug('removeContainer', error);
      throw error;
    }
  }

  async getContainer (name) {
    try {
      return this.docker.getContainer(name);
    } catch (error) {
      debug('getContainer', error);
      throw error;
    }
  }
};

module.exports = {
  Docker
};

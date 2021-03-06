// THIS WAS HIGHLY INSPIRED BY:
//   https://github.com/ssusnic/Machine-Learning-Flappy-Bird/blob/master/source/genetic.js

class GeneticAlgorithm {
  constructor({ game, maxUnits, topUnits }) {
    this.game = game

    this.maxUnits = maxUnits
    this.topUnits = topUnits

    this.rockets = []
    this.brains = []

    this.initData()
    this.initListeners()
    this.initDOM()
  }

  /* -------------------------------------------------------------------------- */
  /*                                INTERNAL DATA                               */
  /* -------------------------------------------------------------------------- */
  initData = () => {
    this.iteration = 1
    this.mutateRate = 1
    this.fittest = null
  }

  initListeners = () => {
    this.iterProxy = Helper.listen(this, 'iteration', (value) => {
      DOMChanger.setGeneration(value)
    })

    this.fitProxy = Helper.listen(this, 'fittest', (value) => {
      DOMChanger.setFittestDOM(value)
    })
  }

  initDOM = () => {
    landedDOM.innerHTML = `Landed: 0/${MAX_UNIT}`
    successRateDOM.innerHTML = 'Success Rate: 0.000%'
  }

  /* -------------------------------------------------------------------------- */
  /*                                   ROCKETS                                  */
  /* -------------------------------------------------------------------------- */
  initRockets = () => {
    this.filterGroup = Body.nextGroup(true)

    // spawn in "maxUnit" amount of rockets
    for (let i = 0; i < this.maxUnits; i++)
      this.rockets.push(
        new Rocket({
          game: this.game,
          x: ROCKET_SPAWN_X,
          y: ROCKET_SPAWN_Y,
          filter: this.filterGroup,
          rotation: ROCKET_SPAWN_ROT,
          velocity: {
            x: ROCKET_SPAWN_VEL_X,
            y: ROCKET_SPAWN_VEL_Y
          }
        })
      )
  }

  resetRockets = () => {
    this.rockets.forEach((rocket) => {
      rocket.reset()
    })
  }

  /* -------------------------------------------------------------------------- */
  /*                              LOOPS AND UPDATES                             */
  /* -------------------------------------------------------------------------- */
  update = (delta) => {
    // This means all rockets have either crashed or landed
    if (this.actives === 0) {
      this.game.removeFocus()
      this.updateData()
      this.evolveBrains()
      this.resetRockets()
      this.iterProxy.iteration = ++this.iteration
    }

    this.rockets.forEach((rocket) => rocket.update(delta))

    this.updateBestRocket()
  }

  updateData = () => {
    const avgFitness =
      this.rockets.reduce((acc, curr) => acc + curr.fitness, 0) /
      this.rockets.length

    const landed = this.rockets.filter((r) => r.state === LANDED_STATE).length
    landedDOM.innerHTML = `Landed: ${landed}/${MAX_UNIT}`

    const successRate = landed / MAX_UNIT
    successRateDOM.innerHTML = `Success Rate: ${(successRate * 100).toFixed(
      TO_FIXED
    )}%`

    this.game.dataPlotter.addData(`${this.iteration}`, avgFitness)
  }

  updateBestRocket = () => {
    const index = Helper.argMax(this.rockets.map((r) => r.fitness))
    const rocket = this.rockets[index]
    rocket.notifyAsBest()
  }

  draw = () => {
    this.rockets.forEach((rocket) => rocket.draw())
  }

  /* -------------------------------------------------------------------------- */
  /*                                 ALGORITHMS                                 */
  /* -------------------------------------------------------------------------- */
  createBrains = () => {
    this.brains.splice(0, this.brains.length)

    for (let i = 0; i < this.maxUnits; i++) {
      const rocket = this.rockets[i]
      const newBrain = new synaptic.Architect.Perceptron(
        INPUT_SIZE,
        HIDDEN_NEURONS,
        4
      )
      newBrain.index = i

      rocket.reset()
      rocket.registerBrain(newBrain)

      this.brains.push(newBrain)
    }
  }

  evolveBrains = () => {
    const winners = this.selection()

    this.fitProxy.fittest = winners[0].gameObject.fitness

    // If the population is too disappointing, create a new one instead
    if (this.mutateRate === 1 && winners[0].gameObject.fitness < 0) {
      console.log('Brains too weak to evolve.')
      this.createBrains()
    } else {
      this.mutateRate = MUTATE_RATE
    }

    // Keep the top units, and evolve the rest of the population
    for (let i = winners.length; i < this.maxUnits; i++) {
      let offspring

      if (i < winners.length + TOP_WINNERS_COUNT) {
        // if within topUnits + count, crossover between parents
        const parentA = winners[0].toJSON()
        const parentB = winners[1].toJSON()
        offspring = this.crossOver(parentA, parentB)
      } else if (i < this.maxUnits - CROSSOVER_WINNER_COUNT) {
        // if within maxUnits - count, crossover between two random winners
        const parentA = this.getRandomBrain(winners).toJSON()
        const parentB = this.getRandomBrain(winners).toJSON()
        offspring = this.crossOver(parentA, parentB)
      } else {
        // clone from a random winner based upon fitness
        offspring = this.getRandomProbBrain(winners).toJSON()
      }

      // mutate offspring for randomness of evolution
      offspring = this.mutation(offspring)

      const newBrain = synaptic.Network.fromJSON(offspring)

      this.brains[i].gameObject.registerBrain(newBrain)
      this.brains[i] = newBrain
    }

    this.brains.sort((a, b) => a.index - b.index)
  }

  selection = () => {
    // sort by descending order
    const sortedBrains = this.brains.sort(
      (a, b) => b.gameObject.fitness - a.gameObject.fitness
    )

    // preserve the landed ones
    let count = 0
    for (let i = 0; i < sortedBrains.length; i++) {
      const brain = sortedBrains[i]
      if (brain.gameObject.state === LANDED_STATE) count++
      else break
    }

    // only return the top units or the ones landed
    return sortedBrains.slice(0, count > this.topUnits ? count : this.topUnits)
  }

  crossOver = (parentA, parentB) => {
    const cutPoint = Helper.randomInt(0, parentA.neurons.length - 1)
    for (let i = cutPoint; i < parentA.neurons.length; i++) {
      const biasFromParentA = parentA.neurons[i].bias
      parentA.neurons[i].bias = parentB.neurons[i].bias
      parentB.neurons[i].bias = biasFromParentA
    }

    return Helper.randomInt(0, 1) === 1 ? parentA : parentB
  }

  mutation = (offspring) => {
    offspring.neurons.forEach((neuron) => {
      neuron.bias = this.mutate(neuron.bias)
    })

    offspring.connections.forEach((connection) => {
      connection.weight = this.mutate(connection.weight)
    })

    return offspring
  }

  mutate = (gene) => {
    if (Math.random() < this.mutateRate) {
      const mutateFactor = 1 + ((Math.random() - 0.5) * 3 + Math.random() - 0.5)
      gene *= mutateFactor
    }

    return gene
  }

  /* -------------------------------------------------------------------------- */
  /*                                   OTHERS                                   */
  /* -------------------------------------------------------------------------- */
  restart = () => {
    this.fitProxy.fittest = -1
    this.iterProxy.iteration = 1

    landedDOM.innerHTML = 'Landed: 0/30'
    successRateDOM.innerHTML = 'Success Rate: 0.000%'

    this.initData()
    this.resetRockets()
    this.createBrains()
  }

  getRandomBrain = (array) => {
    return array[Helper.randomInt(0, array.length - 1)]
  }

  getRandomProbBrain = (array) => {
    // https://natureofcode.com/book/chapter-9-the-evolution-of-code/#95-the-genetic-algorithm-part-ii-selection
    const totalFitness = array.reduce((acc, cur) => {
      return acc + cur.gameObject.fitness
    })

    const normalizedWinners = array.map((winner) => {
      return {
        brain: winner,
        prob: winner.gameObject.fitness / totalFitness
      }
    })

    const winner = Math.random()
    let threshold = 0
    for (let i = 0; i < normalizedWinners.length; i++) {
      threshold += normalizedWinners[i].prob
      if (threshold > winner) {
        return normalizedWinners[i].brain
      }
    }

    return normalizedWinners[0].brain
  }

  get actives() {
    return this.rockets.filter((rocket) => rocket.state === REGULAR_STATE)
      .length
  }
}

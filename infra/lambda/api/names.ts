// Random, friendly identity names: adjective-animal-NNNN.
import { randomInt } from 'node:crypto';

const ADJECTIVES = [
  'amber', 'bold', 'brave', 'bright', 'calm', 'clever', 'cosmic', 'crisp', 'daring', 'dreamy',
  'eager', 'fancy', 'fierce', 'fluffy', 'gentle', 'golden', 'happy', 'humble', 'icy', 'jolly',
  'keen', 'kind', 'lively', 'lucky', 'lunar', 'mellow', 'mighty', 'misty', 'noble', 'pixel',
  'polar', 'proud', 'quick', 'quiet', 'rapid', 'rosy', 'royal', 'rustic', 'shiny', 'silent',
  'silver', 'snowy', 'solar', 'sunny', 'swift', 'tiny', 'vivid', 'wild', 'witty', 'zesty',
];

const ANIMALS = [
  'badger', 'bear', 'bison', 'cobra', 'crane', 'dolphin', 'eagle', 'falcon', 'ferret', 'fox',
  'gecko', 'heron', 'hawk', 'ibis', 'jaguar', 'koala', 'lemur', 'leopard', 'lion', 'llama',
  'lynx', 'marten', 'moose', 'narwhal', 'ocelot', 'orca', 'otter', 'owl', 'panda', 'panther',
  'parrot', 'pelican', 'penguin', 'puffin', 'quokka', 'raven', 'robin', 'salmon', 'seal', 'shark',
  'sparrow', 'squid', 'swan', 'tiger', 'toucan', 'turtle', 'walrus', 'whale', 'wolf', 'yak',
];

export function randomName(): string {
  const adj = ADJECTIVES[randomInt(ADJECTIVES.length)];
  const animal = ANIMALS[randomInt(ANIMALS.length)];
  const num = randomInt(1000, 10000);
  return `${adj}-${animal}-${num}`;
}

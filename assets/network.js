import { networkLayout } from './network-layouts.js';

// The graph is navigation. Its links and initial geometry work before JavaScript loads.
const network = document.querySelector('#index-network');

if (network) {
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const compact = window.matchMedia('(max-width: 600px)');
  const layout = networkLayout;
  const nodes = [...network.querySelectorAll('[data-node]')].map(element => ({
    element,
    id: element.dataset.node,
    x: Number(element.dataset.x) / 100,
    y: Number(element.dataset.y) / 100,
    dx: 0, dy: 0, tx: 0, ty: 0,
    weight: element.matches('a') ? .65 : 1
  }));
  const byId = new Map(nodes.map(node => [node.id, node]));
  const edges = [...network.querySelectorAll('[data-from][data-to]')].map(element => ({
    element,
    from: byId.get(element.dataset.from),
    to: byId.get(element.dataset.to)
  })).filter(edge => edge.from && edge.to);
  let width = network.clientWidth;
  let height = network.clientHeight;
  let frame = null;

  function render() {
    for (const node of nodes) {
      node.element.style.setProperty('--shift-x', node.dx.toFixed(2) + 'px');
      node.element.style.setProperty('--shift-y', node.dy.toFixed(2) + 'px');
    }
    for (const {element, from, to} of edges) {
      element.setAttribute('x1', (from.x * width + from.dx).toFixed(2));
      element.setAttribute('y1', (from.y * height + from.dy).toFixed(2));
      element.setAttribute('x2', (to.x * width + to.dx).toFixed(2));
      element.setAttribute('y2', (to.y * height + to.dy).toFixed(2));
    }
  }

  function step() {
    frame = null;
    let moving = false;
    for (const node of nodes) {
      node.dx += (node.tx - node.dx) * .16;
      node.dy += (node.ty - node.dy) * .16;
      if (Math.abs(node.tx - node.dx) + Math.abs(node.ty - node.dy) > .04) {
        moving = true;
      } else {
        node.dx = node.tx;
        node.dy = node.ty;
      }
    }
    render();
    // Stop drawing as soon as the graph settles; there is no idle animation loop.
    if (moving) frame = window.requestAnimationFrame(step);
  }

  function animate() {
    if (frame === null) frame = window.requestAnimationFrame(step);
  }

  function reset(immediate = false) {
    for (const node of nodes) {
      node.tx = 0;
      node.ty = 0;
      if (immediate) {
        node.dx = 0;
        node.dy = 0;
      }
    }
    if (immediate) {
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = null;
      render();
    } else {
      animate();
    }
  }

  function resize() {
    if (layout) {
      const positions = compact.matches ? layout.mobile : layout.desktop;
      for (const node of nodes) {
        const [x, y] = positions[node.id];
        node.x = x / 100;
        node.y = y / 100;
        node.element.style.setProperty('--x', x);
        node.element.style.setProperty('--y', y);
      }
    }
    width = network.clientWidth;
    height = network.clientHeight;
    reset(true);
  }

  network.addEventListener('pointermove', event => {
    if (motion.matches || event.pointerType !== 'mouse' || !width || !height) return;
    const bounds = network.getBoundingClientRect();
    const px = event.clientX - bounds.left;
    const py = event.clientY - bounds.top;
    const radius = Math.min(width * .45, 190);
    for (const node of nodes) {
      const vx = node.x * width - px;
      const vy = node.y * height - py;
      const distance = Math.hypot(vx, vy);
      const proximity = Math.max(0, 1 - distance / radius);
      const repel = proximity * proximity * 8;
      const parallaxX = (px / width - .5) * 5;
      const parallaxY = (py / height - .5) * 5;
      node.tx = ((distance ? vx / distance : 0) * repel + parallaxX) * node.weight;
      node.ty = ((distance ? vy / distance : 0) * repel + parallaxY) * node.weight;
    }
    animate();
  }, {passive: true});
  network.addEventListener('pointerleave', () => reset(motion.matches));
  network.addEventListener('focusin', () => reset(true));
  window.addEventListener('blur', () => reset(true));
  motion.addEventListener('change', () => reset(true));
  compact.addEventListener('change', resize);

  if ('ResizeObserver' in window) {
    new ResizeObserver(resize).observe(network);
  } else {
    window.addEventListener('resize', resize, {passive: true});
  }
  resize();
}

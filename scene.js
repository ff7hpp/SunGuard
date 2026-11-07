import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { states } from "./farm.js";

function cellTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 192;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  const glass = ctx.createLinearGradient(0, 0, 192, 256);
  glass.addColorStop(0, "#62717d");
  glass.addColorStop(.45, "#40515e");
  glass.addColorStop(1, "#26323c");
  ctx.fillStyle = "#acb3b9";
  ctx.fillRect(0, 0, 192, 256);
  ctx.fillStyle = glass;
  ctx.fillRect(4, 4, 184, 248);
  ctx.strokeStyle = "#83949f";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 19; x < 186; x += 19) {
    ctx.moveTo(x, 4);
    ctx.lineTo(x, 252);
  }
  for (let y = 32; y < 250; y += 32) {
    ctx.moveTo(4, y);
    ctx.lineTo(188, y);
  }
  ctx.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function mountScene(host, panels, select) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  host.append(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, .1, 180);
  camera.position.set(30, 33, 44);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;
  controls.dampingFactor = .075;
  controls.enablePan = true;
  controls.enableZoom = false;
  controls.panSpeed = .7;
  controls.rotateSpeed = .48;
  controls.zoomSpeed = .8;
  controls.minDistance = 19;
  controls.maxDistance = 74;
  controls.minPolarAngle = .28;
  controls.maxPolarAngle = Math.PI / 2.08;
  controls.update();
  function adjustZoom(amount) {
    const direction = new THREE.Vector3().subVectors(camera.position, controls.target).normalize();
    const distance = THREE.MathUtils.clamp(camera.position.distanceTo(controls.target) - amount, controls.minDistance, controls.maxDistance);
    camera.position.copy(controls.target).addScaledVector(direction, distance);
    controls.update();
    requestDraw();
  }
  const grid = new THREE.GridHelper(100, 50, 0x303638, 0x272c2d);
  grid.position.y = -.12;
  grid.material.transparent = true;
  grid.material.opacity = .43;
  scene.add(grid);
  const field = new THREE.Group();
  field.scale.set(1.34, 1, .79);
  scene.add(field);

  const texture = cellTexture();
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const modules = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1.32, 1.88),
    new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }),
    panels.length
  );
  const frame = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1.39, .17, 1.85),
    new THREE.MeshBasicMaterial({ color: 0x343c40 }),
    panels.length
  );
  const meshPose = new THREE.Object3D();
  const colors = new THREE.Color();
  const markers = new Map();
  const markerGeometry = new THREE.RingGeometry(.20, .28, 4);
  const ray = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let scheduled = 0;
  let dragStart;
  let ignoreNextClick = false;

  function update(panel) {
    modules.setColorAt(panel.index, colors.set(states[panel.status].surface));
    modules.instanceColor.needsUpdate = true;
    markers.get(panel.index)?.removeFromParent();
    markers.get(panel.index)?.material.dispose();
    markers.delete(panel.index);
    if (panel.status !== "normal") {
      const mark = new THREE.Mesh(markerGeometry, new THREE.MeshBasicMaterial({
        color: states[panel.status].color, side: THREE.DoubleSide, depthTest: false
      }));
      mark.position.set(
        (panel.col - 13) * 1.46 + (Math.floor((panel.col - 1) / 5) - 2) * .76,
        1.05,
        (panel.row - 10.5) * 1.82 + (Math.floor((panel.row - 1) / 5) - 1.5) * .9
      );
      mark.rotation.x = -Math.PI / 2;
      mark.renderOrder = 1;
      field.add(mark);
      markers.set(panel.index, mark);
    }
    requestDraw();
  }

  for (const panel of panels) {
    const x = (panel.col - 13) * 1.46 + (Math.floor((panel.col - 1) / 5) - 2) * .76;
    const z = (panel.row - 10.5) * 1.82 + (Math.floor((panel.row - 1) / 5) - 1.5) * .9;
    meshPose.position.set(x, .56, z);
    meshPose.rotation.x = -Math.PI / 2 + .27;
    meshPose.updateMatrix();
    modules.setMatrixAt(panel.index, meshPose.matrix);
    meshPose.position.y = .45;
    meshPose.rotation.x = .27;
    meshPose.updateMatrix();
    frame.setMatrixAt(panel.index, meshPose.matrix);
    update(panel);
  }
  field.add(frame, modules);

  function requestDraw() {
    if (!scheduled) scheduled = requestAnimationFrame(draw);
  }

  function draw() {
    scheduled = 0;
    controls.update();
    renderer.domElement.dataset.cameraDistance = camera.position.distanceTo(controls.target).toFixed(2);
    renderer.render(scene, camera);
  }

  new ResizeObserver(([entry]) => {
    const { width, height } = entry.contentRect;
    if (!width || !height) return;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    requestDraw();
  }).observe(host);

  function hit(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1,
      1 - (event.clientY - rect.top) / rect.height * 2);
    ray.setFromCamera(pointer, camera);
    return ray.intersectObject(modules)[0]?.instanceId;
  }

  renderer.domElement.addEventListener("pointerdown", event => {
    dragStart = { x: event.clientX, y: event.clientY };
    ignoreNextClick = false;
  });
  renderer.domElement.addEventListener("pointermove", event => {
    if (dragStart && Math.hypot(event.clientX - dragStart.x, event.clientY - dragStart.y) > 5) {
      ignoreNextClick = true;
    }
    if (event.buttons) return;
    renderer.domElement.style.cursor = hit(event) === undefined ? "grab" : "pointer";
  });
  renderer.domElement.addEventListener("pointerup", () => { dragStart = undefined; });
  renderer.domElement.addEventListener("click", event => {
    if (ignoreNextClick) return;
    const index = hit(event);
    if (index !== undefined) select(index);
  });
  host.addEventListener("wheel", event => {
    event.preventDefault();
    renderer.domElement.dataset.wheelCount = String(Number(renderer.domElement.dataset.wheelCount ?? 0) + 1);
    adjustZoom(Math.sign(event.deltaY) * -4);
  }, { passive: false, capture: true });
  controls.addEventListener("change", requestDraw);

  return {
    update,
    view(name) {
      const views = {
        perspective: { position: [30, 33, 44], target: [0, 0, 0] },
        top: { position: [0, 66, .01], target: [0, 0, 0] }
      };
      const next = views[name] ?? views.perspective;
      camera.position.set(...next.position);
      controls.target.set(...next.target);
      controls.update();
      requestDraw();
    },
    zoom(amount) {
      adjustZoom(amount);
    },
    dispose() {
      controls.dispose();
      renderer.dispose();
      texture.dispose();
    }
  };
}

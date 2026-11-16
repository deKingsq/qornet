import * as T from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'

const v = (x: number, y: number, z: number) => new T.Vector3(x, y, z)
const mat = (color: number, options: T.MeshStandardMaterialParameters) =>
  new T.MeshStandardMaterial({ color, ...options })
function mesh(parent: T.Group, geometry: T.BufferGeometry, material: T.Material, x = 0, y = 0, z = 0) {
  const object = new T.Mesh(geometry, material)
  object.position.set(x, y, z)
  parent.add(object)
  return object
}
function ring(parent: T.Group, radius: number, thickness: number, material: T.Material, x = 0, y = 0, z = 0) {
  return mesh(parent, new T.TorusGeometry(radius, thickness, 9, 96), material, x, y, z)
}

export function buildVault(parent: T.Group, renderer: T.WebGLRenderer) {
  const group = new T.Group()
  parent.add(group)
  const environment = new RoomEnvironment()
  const pmrem = new T.PMREMGenerator(renderer)
  const reflection = pmrem.fromScene(environment, .035)
  const envMap = reflection.texture
  pmrem.dispose()
  environment.dispose()

  const alloy = mat(0xc49962, { envMap, envMapIntensity: 1.2, metalness: .94, roughness: .24 })
  const paleAlloy = mat(0xe1c9a0, { envMap, envMapIntensity: 1.45, metalness: .88, roughness: .19 })
  const frameMetal = mat(0x51766f, { envMap, metalness: .8, roughness: .24 })
  const body = mat(0x123b35, { envMap, metalness: .56, roughness: .25 })
  const face = new T.MeshPhysicalMaterial({ color:0x235d4e, envMap, envMapIntensity:.85, metalness:.24, roughness:.19, transparent:true, opacity:.58, depthWrite:false, clearcoat:1, clearcoatRoughness:.13 })
  const shell = new T.MeshPhysicalMaterial({ color:0x51b391, envMap, envMapIntensity:.76, metalness:.42, roughness:.19, transparent:true, opacity:.19, depthWrite:false, clearcoat:1 })
  const phosphor = new T.MeshBasicMaterial({ color: 0x86edc0 })
  const etching = new T.MeshBasicMaterial({ color:0x437e68 })
  const roundedMesh = (target: T.Group, w: number, h: number, d: number, radius: number, material: T.Material, x = 0, y = 0, z = 0) =>
    mesh(target, new RoundedBoxGeometry(w, h, d, 3, radius), material, x, y, z)
  const disk = (target: T.Group, radius: number, depth: number, material: T.Material, z: number) => {
    const object = mesh(target, new T.CylinderGeometry(radius, radius, depth, 48), material, 0, 0, z)
    object.rotation.x = Math.PI / 2
    return object
  }
  const modules = [
    { position:v(-1.67,-1.11,.18), scale:.99, turn:-.12 },
    { position:v(1.55,-1.34,.18), scale:1, turn:.05 },
    { position:v(.12,1.55,-.03), scale:1.08, turn:.08 },
  ].map(({ position, scale, turn }, i) => {
    const unit = new T.Group()
    group.add(unit)
    unit.scale.setScalar(scale)
    roundedMesh(unit, 2.24, 2.24, 2.24, .23, body)
    roundedMesh(unit, 2.48, 2.48, 2.48, .25, shell)
    roundedMesh(unit, 2.29, 2.29, .17, .16, frameMetal, 0, 0, 1.18)
    roundedMesh(unit, 2.02, 2.02, .08, .12, body, 0, 0, 1.27)
    roundedMesh(unit, 2.11, 2.11, .17, .14, face, 0, 0, 1.25)
    for (const side of [-1, 1]) {
      roundedMesh(unit, 2.50, .16, 2.50, .079, i === 2 ? paleAlloy : alloy, 0, side * 1.01)
      roundedMesh(unit, 2.51, .032, 2.51, .015, frameMetal, 0, side * .88)
      for (const y of [-.48, -.24, 0, .24, .48]) {
        roundedMesh(unit, .044, .083, 1.27, .02, frameMetal, side * 1.143, y, -.13)
      }
      roundedMesh(unit, .102, .44, .16, .047, alloy, side * .93, .03, 1.35)
      for (const y of [-.81, .81]) {
        roundedMesh(unit, .29, .018, .025, .008, etching, side * .67, y, 1.314)
        roundedMesh(unit, .018, .16, .025, .008, etching, side * .81, y * .91, 1.314)
      }
    }

    const dial = new T.Group()
    unit.add(dial)
    disk(dial, .68, .13, frameMetal, 1.38)
    ring(dial, .59, .055, paleAlloy, 0, 0, 1.465)
    disk(dial, .52, .11, body, 1.435)
    ring(dial, .44, .012, frameMetal, 0, 0, 1.5)
    const hand = new T.Group()
    dial.add(hand)
    for (let spoke = 0; spoke < 3; spoke += 1) {
      const angle = spoke * Math.PI * 2 / 3
      roundedMesh(hand, .10, .35, .09, .042, alloy, -Math.sin(angle) * .217, Math.cos(angle) * .217, 1.54).rotation.z = angle
    }
    disk(hand, .13, .11, paleAlloy, 1.57)
    roundedMesh(unit, .23, .033, .023, .011, phosphor, 0, -.775, 1.35)
    return { unit, hand, position, turn }
  })

  const orbit = new T.Group()
  orbit.position.y = -3.13
  parent.add(orbit)
  const ringLight = new T.MeshBasicMaterial({ color: 0x5ab48f, transparent:true, opacity:.55 })
  ring(orbit, 3.13, .012, ringLight).rotation.x = -Math.PI / 2
  ring(orbit, 3.58, .009, new T.MeshBasicMaterial({ color:0x49645e, transparent:true, opacity:.62 })).rotation.x = -Math.PI / 2
  const pulse = mesh(orbit, new T.SphereGeometry(1, 16, 12), phosphor)
  pulse.scale.setScalar(.057)
  return { group, modules, pulse, reflection }
}


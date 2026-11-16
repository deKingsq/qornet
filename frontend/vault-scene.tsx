import { useEffect, useRef } from 'react'
import * as T from 'three'
import { buildVault } from './vault-model.ts'

export default function VaultScene() {
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = host.current
    if (!element) return
    let renderer: T.WebGLRenderer
    try {
      renderer = new T.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' })
    } catch {
      return
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.65))
    renderer.toneMapping = T.ACESFilmicToneMapping
    renderer.setClearColor(0, 0)
    const scene = new T.Scene()
    const camera = new T.PerspectiveCamera(35, 1, .1, 100)
    camera.position.z = 15.2
    scene.add(new T.HemisphereLight(0xb9ffe3, 0x253443, 2.35))
    for (const [color, intensity, x, y, z] of [[0xa8ffdf, 4.1, 3, 7, 6], [0x739bff, 3.3, -6, 1, -4], [0xffffff, 2.5, -1, 5, 7]]) {
      const light = new T.DirectionalLight(color, intensity)
      light.position.set(x, y, z)
      scene.add(light)
    }
    const model = new T.Group()
    scene.add(model)
    const { group, modules, pulse, reflection } = buildVault(model, renderer)
    const pointer = new T.Vector2()
    const tilt = new T.Vector2()
    const reduced = matchMedia('(prefers-reduced-motion: reduce)')
    const start = performance.now()
    let visible = false
    let frame = 0

    function draw(now: number) {
      const staticMode = reduced.matches
      const t = staticMode ? 0 : (now - start) / 1000
      if (staticMode) tilt.set(0, 0)
      else tilt.lerp(pointer, .09)
      group.rotation.set(.16 + Math.sin(t * .74) * .08 + tilt.y * .21, -.41 + Math.sin(t * .67) * .17 + tilt.x * .55, -.045)
      group.position.y = .35 + Math.sin(t * 1.45) * .19
      for (const [i, { unit, hand, position, turn }] of modules.entries()) {
        const progress = staticMode ? 1 : T.MathUtils.clamp((t - i * .1) / .88, 0, 1)
        unit.position.copy(position)
        unit.position.y += Math.sin(t * 1.35 + i * 2) * .105 - (1 - progress) ** 3 * .9
        unit.rotation.set(.06, turn + Math.sin(t * .86 + i) * .058, -.025 + Math.sin(t * .79 + i) * .045)
        hand.rotation.z = i * .5 + Math.sin(t * .85 + i * .7) * .34
      }
      const orbitAngle = t * .74 + .8
      pulse.position.set(Math.cos(orbitAngle) * 3.13, 0, Math.sin(orbitAngle) * 3.13)
      renderer.render(scene, camera)
    }

    function tick(now: number) {
      frame = 0
      draw(now)
      if (visible && !reduced.matches && !document.hidden) frame = requestAnimationFrame(tick)
    }

    function sync() {
      cancelAnimationFrame(frame)
      frame = 0
      if (visible && !document.hidden) tick(performance.now())
    }

    function size() {
      if (!element) return
      const { width, height } = element.getBoundingClientRect()
      if (!width || !height) return
      camera.aspect = width / height
      camera.position.z = Math.max(14.9, 14.9 / camera.aspect)
      camera.updateProjectionMatrix()
      renderer.setSize(width, height, false)
      draw(performance.now())
    }

    function move(event: PointerEvent) {
      if (!element || event.pointerType !== 'mouse' || reduced.matches) return
      const rect = element.getBoundingClientRect()
      pointer.set((event.clientX - rect.left) / rect.width - .5, (event.clientY - rect.top) / rect.height - .5)
    }
    const leave = () => pointer.set(0, 0)
    const lost = () => { cancelAnimationFrame(frame); frame = 0; element.dataset.render = 'fallback' }
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync() })
    const resize = new ResizeObserver(size)
    element.append(renderer.domElement)
    size()
    element.dataset.render = 'webgl'
    observer.observe(element)
    resize.observe(element)
    element.addEventListener('pointermove', move)
    element.addEventListener('pointerleave', leave)
    renderer.domElement.addEventListener('webglcontextlost', lost)
    reduced.addEventListener('change', sync)
    document.addEventListener('visibilitychange', sync)

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      resize.disconnect()
      element.removeEventListener('pointermove', move)
      element.removeEventListener('pointerleave', leave)
      renderer.domElement.removeEventListener('webglcontextlost', lost)
      reduced.removeEventListener('change', sync)
      document.removeEventListener('visibilitychange', sync)
      const materials = new Set<T.Material>()
      model.traverse((object) => {
        if (object instanceof T.Mesh) {
          object.geometry.dispose()
          materials.add(object.material)
        }
      })
      for (const material of materials) material.dispose()
      reflection.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
      renderer.domElement.remove()
      delete element.dataset.render
    }
  }, [])

  return <div className="vault-canvas" ref={host} aria-hidden="true" />
}

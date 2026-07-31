import React from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'

// No hay @testing-library/react-hooks en el repo (headless, sin RN/DOM). Este
// harness mínimo monta el hook en un componente invisible y expone su
// resultado + un rerender con props nuevas, alcanza para lo que testeamos acá.
export function renderHook<TProps, TResult>(hook: (props: TProps) => TResult, initialProps: TProps) {
  const result: { current: TResult } = { current: undefined as unknown as TResult }
  let currentProps = initialProps
  let renderer!: ReactTestRenderer

  function TestComponent({ hookProps }: { hookProps: TProps }) {
    result.current = hook(hookProps)
    return null
  }

  act(() => {
    renderer = create(React.createElement(TestComponent, { hookProps: currentProps }))
  })

  return {
    result,
    rerender(newProps: TProps = currentProps) {
      currentProps = newProps
      act(() => {
        renderer.update(React.createElement(TestComponent, { hookProps: currentProps }))
      })
    },
    unmount() {
      act(() => renderer.unmount())
    },
  }
}

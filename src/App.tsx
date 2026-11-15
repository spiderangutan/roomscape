import { useState } from 'react'
import Editor2D from './components/Editor2D.tsx'
import Plan2D from './components/Plan2D.tsx'
import View3D from './components/View3D.tsx'
import Toolbar from './components/Toolbar.tsx'
import ProjectsPanel from './components/ProjectsPanel.tsx'
import CatalogPanel from './components/CatalogPanel.tsx'
import PropertiesPanel from './components/PropertiesPanel.tsx'
import { CustomItemDialog, NewProjectDialog, NewRoomDialog } from './components/Dialogs.tsx'
import { getProject, getRoom, store, useStoreState } from './lib/store.ts'
import { cx } from './lib/util.ts'

type DialogKind = null | 'project' | 'room' | 'custom'
type Drawer = 'none' | 'left' | 'right'

export default function App() {
  const state = useStoreState()
  const project = getProject(state)
  const room = getRoom(state)
  const [dialog, setDialog] = useState<DialogKind>(null)
  const [drawer, setDrawer] = useState<Drawer>('none')
  const [view2d, setView2d] = useState({ zoom: 0.09, panX: -500, panY: -400 })
  const [viewPlan, setViewPlan] = useState({ zoom: 0.07, panX: -600, panY: -500 })

  const openRoomInEditor = (roomId: string) => {
    store.openRoom(roomId)
    store.setScope('room')
    store.setView('2d')
  }

  return (
    <div className="app">
      <Toolbar
        state={state}
        drawer={drawer}
        onNewRoom={() => setDialog('room')}
        onCustomItem={() => setDialog('custom')}
        onToggleDrawer={(side) => setDrawer((current) => (current === side ? 'none' : side))}
      />

      <div className="workspace">
        <ProjectsPanel
          open={drawer === 'left'}
          onNewProject={() => setDialog('project')}
          onNewRoom={() => setDialog('room')}
          onClose={() => setDrawer('none')}
        />

        <main className="stage-wrap">
          {state.scope === 'home' ? (
            state.view === '2d' ? (
              <Plan2D view={viewPlan} onViewChange={setViewPlan} onOpenRoom={openRoomInEditor} />
            ) : (
              <View3D onAddRoom={() => setDialog('room')} />
            )
          ) : state.view === '2d' ? (
            <Editor2D
              view={view2d}
              onViewChange={setView2d}
              onAddRoom={() => setDialog('room')}
              onAddProject={() => setDialog('project')}
            />
          ) : (
            <View3D onAddRoom={() => setDialog('room')} />
          )}
        </main>

        <aside className={cx('panel panel--right', drawer === 'right' && 'panel--open')}>
          <CatalogPanel onCustomItem={() => setDialog('custom')} onClose={() => setDrawer('none')} />
          {project && room ? (
            <PropertiesPanel state={state} project={project} room={room} />
          ) : (
            <section className="panel__section" aria-label="Properties">
              <div className="panel__head">
                <h2 className="panel__title">Properties</h2>
              </div>
              <p className="muted small">Select a room to see its dimensions and openings.</p>
            </section>
          )}
        </aside>

        {drawer !== 'none' && (
          <button type="button" className="scrim" aria-label="Close panels" onClick={() => setDrawer('none')} />
        )}
      </div>

      <NewProjectDialog open={dialog === 'project'} onClose={() => setDialog(null)} />
      <NewRoomDialog open={dialog === 'room'} onClose={() => setDialog(null)} unit={project?.unit ?? 'ft'} />
      <CustomItemDialog
        open={dialog === 'custom'}
        onClose={() => setDialog(null)}
        unit={project?.unit ?? 'ft'}
        hasRoom={Boolean(room)}
      />
    </div>
  )
}

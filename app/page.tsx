'use client';
import { StoreProvider } from '../lib/store';
import ProviderBar from '../components/ProviderBar';
import ThemeToggle from '../components/ThemeToggle';
import ProjectBar from '../components/ProjectBar';
import PromptBox from '../components/PromptBox';
import OutputTabs from '../components/OutputTabs';
import ExportBar from '../components/ExportBar';
import BoardCanvas2D from '../components/BoardCanvas2D';
import SchematicEditor from '../components/SchematicEditor';
import BoardViewer3D from '../components/BoardViewer3D';
import LabPanel from '../components/LabPanel';
import ScopePanel from '../components/ScopePanel';
import PluginPanel from '../components/PluginPanel';
import LibraryPanel from '../components/LibraryPanel';
import GroundingPanel from '../components/GroundingPanel';
import FabPanel from '../components/FabPanel';
import ErrorBoundary from '../components/ErrorBoundary';
import { card } from '../lib/theme';

const NAV: [string, string][] = [
  ['prompt', 'Prompt'],
  ['results', 'Results'],
  ['schematic', 'Schematic'],
  ['board', 'Board'],
  ['model', '3D Model'],
  ['lab', 'Test Lab'],
  ['library', 'Library'],
  ['fab', 'Fabrication'],
];

const toolbar: React.CSSProperties = {
  position: 'sticky',
  top: 0,
  zIndex: 50,
  background: 'var(--toolbar)',
  backdropFilter: 'blur(20px) saturate(1.6)',
  WebkitBackdropFilter: 'blur(20px) saturate(1.6)',
  borderBottom: '1px solid var(--card-border)',
};

export default function Page() {
  return (
    <StoreProvider>
      <header style={toolbar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 18px', maxWidth: 1280, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexShrink: 0 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg, #0a84ff, #30d158)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 800, color: '#fff' }}>
              ◈
            </div>
            <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em' }}>FOSS-PCB</span>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <ProviderBar />
          </div>
          <ThemeToggle />
        </div>
        <ProjectBar />
      </header>

      <div style={{ display: 'flex', gap: 20, maxWidth: 1280, margin: '0 auto', padding: '20px 18px 60px', alignItems: 'flex-start' }}>
        <nav className="foss-sidebar" style={{ position: 'sticky', top: 132, width: 150, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {NAV.map(([id, label]) => (
            <a key={id} href={`#${id}`} style={{ padding: '7px 12px', borderRadius: 9, fontSize: 13, fontWeight: 500, color: 'var(--text-2)', textDecoration: 'none' }}>
              {label}
            </a>
          ))}
        </nav>

        <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <section id="prompt" style={{ ...card, padding: 20 }}>
            <PromptBox />
          </section>

          <section id="results">
            <ErrorBoundary name="Results">
              <OutputTabs />
            </ErrorBoundary>
          </section>

          <section id="schematic" style={card}>
            <h3>Schematic</h3>
            <ErrorBoundary name="Schematic editor">
              <SchematicEditor />
            </ErrorBoundary>
          </section>

          <section id="board" style={card}>
            <h3>Board layout</h3>
            <ErrorBoundary name="Board editor">
              <BoardCanvas2D />
            </ErrorBoundary>
          </section>

          <section id="model" style={card}>
            <h3>3D model</h3>
            <ErrorBoundary name="3D viewer">
              <BoardViewer3D />
            </ErrorBoundary>
          </section>

          <section id="lab" style={card}>
            <h3>Test lab</h3>
            <div className="foss-grid-2">
              <ErrorBoundary name="Lab">
                <LabPanel />
              </ErrorBoundary>
              <ErrorBoundary name="Oscilloscope">
                <ScopePanel />
              </ErrorBoundary>
            </div>
          </section>

          <section id="library" style={card}>
            <div className="foss-grid-2">
              <ErrorBoundary name="Library">
                <LibraryPanel />
              </ErrorBoundary>
              <ErrorBoundary name="Grounding">
                <GroundingPanel />
              </ErrorBoundary>
            </div>
          </section>

          <section id="fab" style={card}>
            <div className="foss-grid-2">
              <ErrorBoundary name="Fabrication">
                <FabPanel />
              </ErrorBoundary>
              <ErrorBoundary name="Plugins">
                <PluginPanel />
              </ErrorBoundary>
            </div>
            <div style={{ marginTop: 12 }}>
              <ErrorBoundary name="KiCad export">
                <ExportBar />
              </ErrorBoundary>
            </div>
          </section>
        </main>
      </div>
    </StoreProvider>
  );
}

import {
  Activity,
  Archive,
  BarChart3,
  BrainCircuit,
  Cpu,
  FlaskConical,
  Gauge,
  History,
  LayoutDashboard,
  Network,
  Target,
  Wand2
} from 'lucide-react';

export const GAMES = [
  { key: '6din49', label: '6/49', full: 'Loto 6/49' },
  { key: '5din40', label: '5/40', full: 'Loto 5/40' },
  { key: 'joker', label: 'Joker', full: 'Joker' }
];

export const STRATEGIES = [
  { key: 'balanced', label: 'Balanced', icon: Gauge, description: 'Blends hot, cold and overdue signals evenly.' },
  { key: 'hot', label: 'Hot', icon: Activity, description: 'Favors numbers drawn most often in the archive.' },
  { key: 'cold', label: 'Cold', icon: BarChart3, description: 'Targets numbers that appear least frequently.' },
  { key: 'overdue', label: 'Overdue', icon: Target, description: 'Prioritizes numbers absent for many draws.' },
  { key: 'monte_carlo', label: 'MC Ticket Generator', icon: BrainCircuit, description: 'Generates archive-weighted tickets through repeated ticket simulations.' },
  { key: 'ml_sklearn', label: 'ML (sklearn)', icon: Cpu, description: 'Gradient boosting on rolling frequency features.' },
  { key: 'ml_lstm', label: 'ML (LSTM)', icon: Network, description: 'LSTM trained on sequential draw history to predict numbers.' }
];

export const VIEWS = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'statistics', label: '6/49 Statistical Lab', icon: FlaskConical },
  { key: 'archive', label: 'Archive history', icon: History },
  { key: 'generator', label: 'Generator', icon: Wand2 }
];

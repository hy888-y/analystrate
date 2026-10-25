import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { Shell } from './components/Shell';
import { AnalystPage } from './pages/Analyst.page';
import { AnalystsPage } from './pages/Analysts.page';
import { BrokersPage } from './pages/Brokers.page';
import { InsightsPage } from './pages/Insights.page';
import { CallsPage, StocksPage } from './pages/Lists.page';
import { MethodPage } from './pages/Method.page';
import { StockPage } from './pages/Stock.page';

const router = createBrowserRouter([
  {
    element: <Shell />,
    children: [
      { path: '/', element: <InsightsPage /> },
      { path: '/analysts', element: <AnalystsPage /> },
      { path: '/analysts/:id', element: <AnalystPage /> },
      { path: '/stocks', element: <StocksPage /> },
      { path: '/stocks/:code', element: <StockPage /> },
      { path: '/brokers', element: <BrokersPage /> },
      { path: '/calls', element: <CallsPage /> },
      { path: '/method', element: <MethodPage /> },
    ],
  },
]);

export function Router() {
  return <RouterProvider router={router} />;
}

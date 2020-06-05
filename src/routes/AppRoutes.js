import React, { Suspense, lazy } from "react";
import { Route, Switch } from "react-router-dom";

const Portfolio = lazy(() => import("./Portfolio/Portfolio"));
const Lab = lazy(() => import("./Lab/Lab"));
const Calendar = lazy(() => import("./Calendar/Calendar"));
const Home = lazy(() => import("./Home/Home"));
const FourOhFour = lazy(() => import("./FourOhFour/FourOhFour"));

const AppRoutes = () => {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <Switch>
        <Route path="/portfolio" component={Portfolio} />
        <Route path="/lab" component={Lab} />
        <Route path="/calendar" exact component={Calendar} />
        <Route path="/" exact component={Home} />
        <Route component={FourOhFour} />
      </Switch>
    </Suspense>
  );
};

export default AppRoutes;

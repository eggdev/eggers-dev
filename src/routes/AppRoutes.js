import React, { Suspense, lazy } from "react";
import { Route, Switch } from "react-router-dom";
import RouteContainer from "../components/RouteContainer/RouteContainer";

const Portfolio = lazy(() => import("./Portfolio/Portfolio"));
const Resume = lazy(() => import("./Resume/Resume"));
const Home = lazy(() => import("./Home/Home"));
const FourOhFour = lazy(() => import("./FourOhFour/FourOhFour"));

const AppRoutes = () => {
  return (
    <RouteContainer>
      <Suspense fallback={<div>Loading...</div>}>
        <Switch>
          <Route path="/portfolio" component={Portfolio} />
          <Route path="/resume" exact component={Resume} />
          <Route path="/" exact component={Home} />
          <Route component={FourOhFour} />
        </Switch>
      </Suspense>
    </RouteContainer>
  );
};

export default AppRoutes;

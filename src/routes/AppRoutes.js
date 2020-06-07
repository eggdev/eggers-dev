import React, { useEffect, Suspense, lazy } from "react";
import { Route, Switch, useLocation } from "react-router-dom";
import Container from "@material-ui/core/Container";
import LoadingContainer from "../components/LoadingContainer/LoadingContainer";

import Home from "./Home/Home";

const Portfolio = lazy(() => {
  return new Promise((resolve) =>
    resolve(import("./Portfolio/Portfolio"), 5000)
  );
});

const Jobs = lazy(() => {
  return new Promise((resolve) => resolve(import("./Jobs/Jobs"), 5000));
});

const Lab = lazy(() => {
  return new Promise((resolve) => resolve(import("./Lab/Lab"), 5000));
});

const FourOhFour = lazy(() =>
  import("../components/ErrorComponent/ErrorComponent")
);

const AppRoutes = () => {
  const location = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location]);

  return (
    <Container>
      <Suspense fallback={<LoadingContainer />}>
        <Switch>
          <Route path="/portfolio" component={Portfolio} />
          <Route path="/jobs" exact component={Jobs} />
          <Route path="/lab" exact component={Lab} />
          <Route path="/" exact component={Home} />
          <Route component={FourOhFour} />
        </Switch>
      </Suspense>
    </Container>
  );
};

export default AppRoutes;

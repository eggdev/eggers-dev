import React from "react";
import { AppBar, Toolbar } from "@material-ui/core";
import Link from "../../components/Link/Link";

const AppNav = () => {
  return (
    <AppBar position="static">
      <Toolbar>
        <Link to="/">Home</Link>
        <Link to="/portfolio">Portfolio</Link>
        <Link to="/history">History</Link>
      </Toolbar>
    </AppBar>
  );
};

export default AppNav;

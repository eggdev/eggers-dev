import React, { useState } from "react";
import { makeStyles } from "@material-ui/core/styles";
import Fab from "@material-ui/core/Fab";
import AppsIcon from "@material-ui/icons/Apps";
import DevicesIcon from "@material-ui/icons/Devices";
import HomeIcon from "@material-ui/icons/Home";
import WorkIcon from "@material-ui/icons/Work";
import SpeedDialAction from "../SpeedDialAction/SpeedDialAction";
import DeveloperModeIcon from "@material-ui/icons/DeveloperMode";
import ClickAwayListener from "@material-ui/core/ClickAwayListener";

const dialRadius = 32;
const spacingActions = 16;

const useStyles = makeStyles((theme) => ({
  speedDialContainer: {
    position: "fixed",
    bottom: theme.spacing(2),
    right: theme.spacing(2),
    zIndex: theme.zIndex.tooltip,
    display: "flex",
    flexDirection: "column-reverse",
    alignItems: "center",
    "& #apps-fab": {
      marginTop: theme.spacing(1),
    },
  },
  actions: {
    display: "flex",
    flexDirection: "column-reverse",
    marginBottom: -dialRadius,
    paddingBottom: spacingActions + dialRadius,
  },
}));

const routes = [
  { to: "/", icon: HomeIcon, name: "Home" },
  { to: "/portfolio", icon: DevicesIcon, name: "Portfolio" },
  { to: "/jobs", icon: WorkIcon, name: "Jobs" },
  { to: "/lab", icon: DeveloperModeIcon, name: "Lab" },
  {
    to: "toggle",
    name: "Dark Mode",
  },
];

const SpeedDial = ({ isDarkMode, toggleDarkMode }) => {
  const [open, setOpen] = useState(false);
  const { speedDialContainer } = useStyles();
  const handleClick = () => setOpen(!open);

  return (
    <ClickAwayListener onClickAway={() => setOpen(false)}>
      <div className={speedDialContainer}>
        <Fab onClick={handleClick} id="apps-fab">
          <AppsIcon fontSize="large" />
        </Fab>
        {routes.map(({ icon: RouteIcon, to, name }, index) => (
          <SpeedDialAction
            key={name}
            open={open}
            isDarkMode={isDarkMode}
            toggleDarkMode={toggleDarkMode}
            dialLength={routes.length}
            handleClick={handleClick}
            RouteIcon={RouteIcon}
            index={index}
            name={name}
            to={to}
          />
        ))}
      </div>
    </ClickAwayListener>
  );
};

export default SpeedDial;

import React, { useState } from "react";
import { makeStyles } from "@material-ui/core/styles";
import Fab from "@material-ui/core/Fab";
import AppsIcon from "@material-ui/icons/Apps";
import ImportantDevicesIcon from "@material-ui/icons/ImportantDevices";
import HomeIcon from "@material-ui/icons/Home";
// import OutdoorGrillIcon from "@material-ui/icons/OutdoorGrill";
import WorkIcon from "@material-ui/icons/Work";
import SpeedDialAction from "../SpeedDialAction/SpeedDialAction";

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
  },
  actions: {
    display: "flex",
    flexDirection: "column-reverse",
    marginBottom: -dialRadius,
    paddingBottom: spacingActions + dialRadius,
  },
  actionsClosed: {
    display: "none",
  },
}));

const routes = [
  { to: "/", icon: HomeIcon, name: "Home" },
  { to: "/portfolio", icon: ImportantDevicesIcon, name: "Portfolio" },
  { to: "/jobs", icon: WorkIcon, name: "Jobs" },
  // { to: "/lab", icon: OutdoorGrillIcon, name: "Lab" },
  {
    to: "toggle",
    name: "Dark Mode",
  },
];

const SpeedDial = ({ isDarkMode, toggleDarkMode }) => {
  const [open, setOpen] = useState(false);
  const { speedDialContainer, actions } = useStyles();
  const handleClick = () => setOpen(!open);

  return (
    <ClickAwayListener onClickAway={() => setOpen(false)}>
      <div className={speedDialContainer}>
        <Fab onClick={handleClick}>
          <AppsIcon fontSize="large" />
        </Fab>
        {open && (
          <div className={actions}>
            {routes.map(({ icon: RouteIcon, to, name }, index) => (
              <SpeedDialAction
                key={name}
                open={open}
                isDarkMode={isDarkMode}
                toggleDarkMode={toggleDarkMode}
                handleClick={handleClick}
                RouteIcon={RouteIcon}
                to={to}
                index={index}
              />
            ))}
          </div>
        )}
      </div>
    </ClickAwayListener>
  );
};

export default SpeedDial;

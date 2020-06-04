import React from 'react';
import { makeStyles } from "@material-ui/core/styles";

const useStyles = makeStyles(theme => ({
    mobileProjectContainer: {
        backgroundSize: "cover",
        backgroundPosition: "center",
        border: `1px solid ${theme.palette.common.black}`,
        height: "200px",
        width: "20%"
    }
}));

const MobileContainer = ({ mobile_image }) => {
    const classes = useStyles();
    return <div></div>
    // return <div className={classes.mobileProjectContainer} style={{ backgroundImage: `url(${mobile_image})`}} />
}

export default MobileContainer;
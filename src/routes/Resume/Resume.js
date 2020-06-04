import React from 'react';
import Container from '@material-ui/core/Container';
import { makeStyles } from "@material-ui/core/styles";

const useStyles = makeStyles(theme => ({
	imageTagStyles: {
		maxWidth: "100%"
	}
}))

const Resume = () => {
	const { imageTagStyles } = useStyles();
	return ( 
    <Container maxWidth="md">
			<img className={imageTagStyles} src={`${process.env.PUBLIC_URL}/resume.png`} />
    </Container>
	);
};

export default Resume;

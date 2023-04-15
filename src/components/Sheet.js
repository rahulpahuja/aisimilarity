import React, { Component } from 'react';

export default class Sheet extends React.Component{
    render(){
        return <h3 >T {this.props.title}</h3>;
    }
}